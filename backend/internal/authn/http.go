package authn

import (
	"context"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/labstack/echo/v5"
	"github.com/nao317/mobile_tracer/backend/internal/business"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func safe(method string) bool {
	return method == http.MethodGet || method == http.MethodHead || method == http.MethodOptions
}
func (s *Service) cookieName(kind string) string {
	prefix := "mt_"
	if s.cfg.SecureCookies {
		prefix = "__Host-mt_"
	}
	return prefix + kind
}
func oneCookie(r *http.Request, name string) (*http.Cookie, error) {
	var found *http.Cookie
	for _, c := range r.Cookies() {
		if c.Name == name {
			if found != nil {
				return nil, business.Unauthorized()
			}
			found = c
		}
	}
	if found == nil {
		return nil, http.ErrNoCookie
	}
	return found, nil
}
func (s *Service) cookie(c *echo.Context, kind, value string, expiry time.Time, httpOnly bool) {
	maxAge := int(time.Until(expiry).Seconds())
	if value == "" {
		maxAge = -1
		expiry = time.Unix(1, 0)
	} else if maxAge < 1 {
		maxAge = 1
	}
	c.SetCookie(&http.Cookie{Name: s.cookieName(kind), Value: value, Path: "/", HttpOnly: httpOnly, Secure: s.cfg.SecureCookies, SameSite: http.SameSiteLaxMode, MaxAge: maxAge, Expires: expiry})
}
func (s *Service) clear(c *echo.Context) {
	for _, kind := range []string{"session", "session_id", "login", "access", "refresh", "oauth", "csrf"} {
		s.cookie(c, kind, "", time.Time{}, kind != "csrf")
	}
}
func (s *Service) issueCookies(c *echo.Context, session Session, token, csrf string) {
	s.cookie(c, "session", token, session.ExpiresAt, true)
	s.cookie(c, "session_id", session.ID, session.ExpiresAt, true)
	s.cookie(c, "csrf", csrf, session.ExpiresAt, false)
}
func (s *Service) sameOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		if ref, err := url.Parse(r.Referer()); err == nil && ref.Host != "" {
			origin = ref.Scheme + "://" + ref.Host
		}
	}
	return origin == s.cfg.PublicURL && r.Header.Get("Sec-Fetch-Site") != "cross-site"
}
func (s *Service) csrf(r *http.Request, session Session) error {
	if !s.sameOrigin(r) {
		return business.Forbidden()
	}
	cookie, err := oneCookie(r, s.cookieName("csrf"))
	if err != nil {
		return business.Forbidden()
	}
	supplied := r.Header.Get("X-CSRF-Token")
	if supplied == "" && strings.HasPrefix(r.Header.Get("Content-Type"), "application/x-www-form-urlencoded") {
		supplied = r.FormValue("_csrf")
	}
	if len(supplied) > 256 || !equal(supplied, cookie.Value) || !equal(digest(supplied), session.CSRFHash) {
		return business.Forbidden()
	}
	return nil
}
func (s *Service) Register(e *echo.Echo) {
	g := e.Group("/api/auth", func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c *echo.Context) error {
			c.Response().Header().Set("Cache-Control", "no-store")
			c.Response().Header().Set("Referrer-Policy", "no-referrer")
			ctx, cancel := context.WithTimeout(c.Request().Context(), 15*time.Second)
			defer cancel()
			c.SetRequest(c.Request().WithContext(ctx))
			c.Request().Body = http.MaxBytesReader(c.Response(), c.Request().Body, 16384)
			return next(c)
		}
	})
	g.GET("/config", func(c *echo.Context) error {
		return c.JSON(200, map[string]any{"data": map[string]any{"enabled": s.Enabled(), "apiKey": s.cfg.APIKey, "authDomain": s.cfg.AuthDomain, "projectId": s.cfg.ProjectID, "appId": s.cfg.AppID, "emulatorUrl": s.cfg.EmulatorURL}})
	})
	g.GET("/login-challenge", s.challenge)
	g.POST("/session", s.login)
	g.GET("/me", s.me)
	g.POST("/logout", s.logout)
	g.POST("/membership", s.selectMembership)
	e.GET("/api/admin/context", func(c *echo.Context) error {
		c.Response().Header().Set("Cache-Control", "no-store")
		a, err := s.Authenticate(c.Request())
		if err != nil {
			return err
		}
		if !s.admin(a.User) {
			return business.Forbidden()
		}
		return c.JSON(200, map[string]any{"data": map[string]any{"user": a.User, "system_admin": true}})
	})
}

// A single-use challenge bound to an HttpOnly cookie prevents login CSRF.
func (s *Service) challenge(c *echo.Context) error {
	if !s.Enabled() {
		return business.Unauthorized()
	}
	if c.Request().Header.Get("Sec-Fetch-Site") == "cross-site" {
		return business.Forbidden()
	}
	token, browser := randomToken(), randomToken()
	expiry := time.Now().UTC().Add(5 * time.Minute)
	if err := s.db.WithContext(c.Request().Context()).Table("auth.login_challenges").Create(map[string]any{"challenge_hash": digest(token), "browser_hash": digest(browser), "expires_at": expiry}).Error; err != nil {
		return err
	}
	s.cookie(c, "login", browser, expiry, true)
	return c.JSON(200, map[string]any{"data": map[string]string{"csrf_token": token}})
}
func (s *Service) login(c *echo.Context) error {
	if !s.Enabled() {
		return business.Unauthorized()
	}
	if !s.sameOrigin(c.Request()) {
		return business.Forbidden()
	}
	browser, err := oneCookie(c.Request(), s.cookieName("login"))
	challenge := c.Request().Header.Get("X-CSRF-Token")
	if err != nil || len(challenge) < 32 || len(challenge) > 256 {
		return business.Forbidden()
	}
	result := s.db.WithContext(c.Request().Context()).Exec("UPDATE auth.login_challenges SET used_at=now() WHERE challenge_hash=? AND browser_hash=? AND used_at IS NULL AND expires_at>now()", digest(challenge), digest(browser.Value))
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return business.Forbidden()
	}
	s.cookie(c, "login", "", time.Time{}, true)
	var in struct {
		IDToken string `json:"id_token"`
	}
	if err := decodeJSON(c.Request(), &in); err != nil {
		return err
	}
	if len(in.IDToken) == 0 || len(in.IDToken) > 8192 {
		return business.Unauthorized()
	}
	identity, err := s.provider.VerifyIDTokenAndCheckRevoked(c.Request().Context(), in.IDToken)
	fail := func() error { s.failure(c.Request().Context(), "invalid_identity"); return business.Unauthorized() }
	if err != nil || identity == nil || identity.UID == "" || len(identity.UID) > 128 || identity.Issuer != s.cfg.FirebaseIssuer() {
		return fail()
	}
	email, _ := identity.Claims["email"].(string)
	verified, _ := identity.Claims["email_verified"].(bool)
	age := time.Now().Unix() - identity.AuthTime
	if !verified || email == "" || len(email) > 320 || identity.AuthTime == 0 || age < 0 || age > 300 {
		return fail()
	}
	token, err := s.provider.SessionCookie(c.Request().Context(), in.IDToken, s.cfg.SessionTTL)
	if err != nil {
		return fail()
	}
	// Store only the hash; the Firebase cookie is a credential.
	csrf := randomToken()
	var session Session
	err = s.db.WithContext(c.Request().Context()).Transaction(func(tx *gorm.DB) error {
		if err := tx.Table("auth.users").Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "issuer"}, {Name: "subject"}}, DoUpdates: clause.AssignmentColumns([]string{"email", "email_verified"})}).Create(map[string]any{"issuer": s.cfg.FirebaseIssuer(), "subject": identity.UID, "email": strings.ToLower(email), "email_verified": verified}).Error; err != nil {
			return err
		}
		var user User
		if err := tx.Table("auth.users").Where("issuer=? AND subject=?", s.cfg.FirebaseIssuer(), identity.UID).Take(&user).Error; err != nil {
			return err
		}
		if user.Status != "active" {
			return business.Forbidden()
		}
		bound := *s
		bound.db = tx
		memberships, err := bound.memberships(c.Request().Context(), user.ID)
		if err != nil {
			return err
		}
		session = Session{ID: newUUID(), UserID: user.ID, CSRFHash: digest(csrf), TokenHash: digest(token), ExpiresAt: time.Now().UTC().Add(s.cfg.SessionTTL)}
		if len(memberships) == 1 {
			session.SelectedStaffID = &memberships[0].StaffID
		}
		if err := tx.Table("auth.sessions").Create(map[string]any{"id": session.ID, "user_id": session.UserID, "selected_staff_id": session.SelectedStaffID, "csrf_hash": session.CSRFHash, "token_hash": session.TokenHash, "expires_at": session.ExpiresAt}).Error; err != nil {
			return err
		}
		return s.audit(c.Request().Context(), tx, "auth.login", "succeeded", &user.ID)
	})
	if err != nil {
		return err
	}
	s.clear(c)
	s.issueCookies(c, session, token, csrf)
	s.logger.InfoContext(c.Request().Context(), "authentication succeeded", "event", "login", "user_id", session.UserID)
	return c.JSON(200, map[string]any{"data": map[string]string{"status": "logged_in"}})
}
func (s *Service) me(c *echo.Context) error {
	a, err := s.Authenticate(c.Request())
	if err != nil {
		return err
	}
	memberships, err := s.memberships(c.Request().Context(), a.User.ID)
	if err != nil {
		return err
	}
	csrf := ""
	if cookie, err := oneCookie(c.Request(), s.cookieName("csrf")); err == nil && equal(digest(cookie.Value), a.Session.CSRFHash) {
		csrf = cookie.Value
	}
	return c.JSON(200, map[string]any{"data": map[string]any{"user": a.User, "memberships": memberships, "selected_staff_id": a.Session.SelectedStaffID, "system_admin": s.admin(a.User), "csrf_token": csrf}})
}
func (s *Service) selectMembership(c *echo.Context) error {
	a, err := s.Authenticate(c.Request())
	if err != nil {
		return err
	}
	if err := s.csrf(c.Request(), a.Session); err != nil {
		return err
	}
	var in struct {
		StaffID string `json:"staff_id"`
	}
	if err := decodeJSON(c.Request(), &in); err != nil {
		return err
	}
	if !business.ValidID(in.StaffID) {
		return business.Invalid("staff_id", "紐付け済みの担当者を指定してください。")
	}
	memberships, err := s.memberships(c.Request().Context(), a.User.ID)
	if err != nil {
		return err
	}
	allowed := false
	for _, m := range memberships {
		if m.StaffID == in.StaffID {
			allowed = true
		}
	}
	if !allowed {
		return business.Forbidden()
	}
	err = s.db.WithContext(c.Request().Context()).Transaction(func(tx *gorm.DB) error {
		result := tx.Table("auth.sessions").Where("id=? AND revoked_at IS NULL AND expires_at>now()", a.Session.ID).Update("selected_staff_id", in.StaffID)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return business.Unauthorized()
		}
		return s.audit(c.Request().Context(), tx, "auth.membership", "succeeded", &a.User.ID)
	})
	if err != nil {
		return err
	}
	return c.JSON(200, map[string]any{"data": map[string]string{"staff_id": in.StaffID}})
}

// Logout revokes this application's session immediately. Firebase console revocation,
// account disablement and password resets are also checked on every request.
func (s *Service) logout(c *echo.Context) error {
	a, err := s.Authenticate(c.Request())
	if err != nil {
		return err
	}
	if err := s.csrf(c.Request(), a.Session); err != nil {
		return err
	}
	err = s.db.WithContext(c.Request().Context()).Transaction(func(tx *gorm.DB) error {
		result := tx.Table("auth.sessions").Where("id=? AND revoked_at IS NULL", a.Session.ID).Update("revoked_at", time.Now().UTC())
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return business.Unauthorized()
		}
		return s.audit(c.Request().Context(), tx, "auth.logout", "succeeded", &a.User.ID)
	})
	if err != nil {
		return err
	}
	s.clear(c)
	return c.JSON(200, map[string]any{"data": map[string]string{"status": "logged_out"}})
}
