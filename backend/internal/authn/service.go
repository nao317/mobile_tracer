package authn

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/nao317/mobile_tracer/backend/internal/business"
	"github.com/nao317/mobile_tracer/backend/internal/config"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type Service struct {
	timestampAPI   TimestampAPI
	timestampScope string
	workflowChain  WorkflowChain
	db             *gorm.DB
	cfg            config.Auth
	provider       Provider
	business       *business.Service
	logger         *slog.Logger
}
type User struct {
	ID            string `json:"id"`
	Issuer        string `json:"-"`
	Subject       string `json:"-"`
	Email         string `json:"email"`
	EmailVerified bool   `json:"email_verified"`
	AccountType   string `json:"account_type"`
	DisplayName   string `json:"display_name"`
	Status        string `json:"-"`
}
type Session struct {
	ID, UserID           string
	SelectedStaffID      *string
	CSRFHash             string
	TokenHash            string
	CreatedAt, ExpiresAt time.Time
	RevokedAt            *time.Time
}
type Membership struct {
	TenantID    string `json:"tenant_id"`
	TenantName  string `json:"tenant_name"`
	StaffID     string `json:"staff_id"`
	DisplayName string `json:"display_name"`
}
type Authenticated struct {
	User    User
	Session Session
}

func New(db *gorm.DB, cfg config.Auth, provider Provider, logger *slog.Logger) *Service {
	return &Service{db: db, cfg: cfg, provider: provider, business: business.New(db), logger: logger}
}
func (s *Service) Enabled() bool { return s != nil && s.cfg.Enabled }
func (s *Service) audit(ctx context.Context, tx *gorm.DB, action, result string, userID *string) error {
	event := struct {
		Action, Result string
		UserID         *string
		At             time.Time
	}{action, result, userID, time.Now().UTC()}
	data, err := json.Marshal(event)
	if err != nil {
		return err
	}
	return tx.WithContext(ctx).Table("audit.events").Create(map[string]any{"actor_type": "system", "action": action, "target_type": "auth_user", "target_id": userID, "result": result, "created_at": event.At, "details": "{}", "entry_hash": digest(string(data))}).Error
}
func (s *Service) failure(ctx context.Context, reason string) {
	s.logger.WarnContext(ctx, "authentication failed", "reason", reason)
	if err := s.audit(ctx, s.db, "auth.login", "denied", nil); err != nil {
		s.logger.ErrorContext(ctx, "authentication audit failed")
	}
}
func (s *Service) memberships(ctx context.Context, userID string) ([]Membership, error) {
	rows := []Membership{}
	err := s.db.WithContext(ctx).Table("auth.staff_links l").Select("l.tenant_id, t.name AS tenant_name, l.staff_id, st.display_name").
		Joins("JOIN app.staff_members st ON st.id=l.staff_id AND st.tenant_id=l.tenant_id").Joins("JOIN app.tenants t ON t.id=l.tenant_id").
		Where("l.user_id=? AND l.revoked_at IS NULL AND st.status='active' AND t.status='active'", userID).
		Where("EXISTS (SELECT 1 FROM app.staff_role_assignments r WHERE r.staff_id=st.id AND r.tenant_id=t.id AND r.revoked_at IS NULL)").Order("t.name, l.staff_id").Find(&rows).Error
	return rows, err
}
func (s *Service) admin(u User) bool {
	return u.EmailVerified && s.cfg.AdminEmails[strings.ToLower(u.Email)]
}

func (s *Service) Authenticate(r *http.Request) (Authenticated, error) {
	if !s.Enabled() {
		return Authenticated{}, business.Unauthorized()
	}
	// A Firebase ID token is exchanged only at /session. Business APIs use the
	// HttpOnly Firebase session cookie bound to a live local session.
	if r.Header.Get("Authorization") != "" {
		return Authenticated{}, business.Unauthorized()
	}
	cookie, err := oneCookie(r, s.cookieName("session"))
	if err != nil || cookie.Value == "" || len(cookie.Value) > 8192 {
		return Authenticated{}, business.Unauthorized()
	}
	sid, idErr := oneCookie(r, s.cookieName("session_id"))
	if idErr != nil || !business.ValidID(sid.Value) {
		return Authenticated{}, business.Unauthorized()
	}
	var session Session
	err = s.db.WithContext(r.Context()).Table("auth.sessions").Where("id=? AND token_hash=? AND revoked_at IS NULL AND expires_at>now()", sid.Value, digest(cookie.Value)).Take(&session).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return Authenticated{}, business.Unauthorized()
	}
	if err != nil {
		return Authenticated{}, err
	}
	identity, err := s.provider.VerifySessionCookieAndCheckRevoked(r.Context(), cookie.Value)
	if err != nil || identity == nil {
		return Authenticated{}, business.Unauthorized()
	}
	var user User
	err = s.db.WithContext(r.Context()).Table("auth.users").Where("id=? AND status='active'", session.UserID).Take(&user).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return Authenticated{}, business.Unauthorized()
	}
	if err != nil {
		return Authenticated{}, err
	}
	if user.Subject != identity.UID || user.Issuer != s.cfg.FirebaseIssuer() {
		return Authenticated{}, business.Unauthorized()
	}
	// Use current Firebase claims for administrative access, never a stale DB email.
	email, _ := identity.Claims["email"].(string)
	verified, _ := identity.Claims["email_verified"].(bool)
	if !verified || email == "" {
		return Authenticated{}, business.Unauthorized()
	}
	user.Email, user.EmailVerified = email, verified
	return Authenticated{User: user, Session: session}, nil
}
func (s *Service) AuthorizeBusiness(r *http.Request) (business.Principal, error) {
	a, err := s.Authenticate(r)
	if err != nil {
		return business.Principal{}, err
	}
	if !safe(r.Method) {
		if err := s.csrf(r, a.Session); err != nil {
			return business.Principal{}, err
		}
	}
	if a.Session.SelectedStaffID == nil {
		return business.Principal{}, business.Forbidden()
	}
	var count int64
	err = s.db.WithContext(r.Context()).Table("auth.staff_links").Where("user_id=? AND staff_id=? AND revoked_at IS NULL", a.User.ID, *a.Session.SelectedStaffID).Count(&count).Error
	if err != nil {
		return business.Principal{}, err
	}
	if count != 1 {
		return business.Principal{}, business.Forbidden()
	}
	if a.User.AccountType != "business" {
		return business.Principal{}, business.Forbidden()
	}
	return s.business.ResolveStaff(r.Context(), *a.Session.SelectedStaffID)
}

// LinkStaff is an operator-only provisioning operation. Email is never used as a linking key.
func LinkStaff(ctx context.Context, db *gorm.DB, projectID, subject, staffID string, remove bool) error {
	if projectID == "" || len(subject) == 0 || len(subject) > 128 || strings.ContainsAny(subject, " \t\r\n") || !business.ValidID(staffID) {
		return errors.New("firebase project, uid and a valid staff-id are required")
	}
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var user User
		if err := tx.Table("auth.users").Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "issuer"}, {Name: "subject"}}, DoNothing: true}).Create(map[string]any{"issuer": (config.Auth{ProjectID: projectID}).FirebaseIssuer(), "subject": subject}).Error; err != nil {
			return err
		}
		if err := tx.Table("auth.users").Where("issuer=? AND subject=?", (config.Auth{ProjectID: projectID}).FirebaseIssuer(), subject).Take(&user).Error; err != nil {
			return err
		}
		var staff struct{ ID, TenantID string }
		if err := tx.Table("app.staff_members").Where("id=?", staffID).Take(&staff).Error; err != nil {
			return errors.New("staff-id does not identify an existing staff member")
		}
		if remove {
			if err := tx.Table("auth.staff_links").Where("user_id=? AND staff_id=? AND revoked_at IS NULL", user.ID, staff.ID).Update("revoked_at", time.Now().UTC()).Error; err != nil {
				return err
			}
		} else {
			// The partial unique index makes retries harmless without modifying previous links.
			if err := tx.Exec("INSERT INTO auth.staff_links(user_id,tenant_id,staff_id) VALUES (?,?,?) ON CONFLICT DO NOTHING", user.ID, staff.TenantID, staff.ID).Error; err != nil {
				return err
			}
			if err := tx.Table("auth.users").Where("id=? AND account_type='general'", user.ID).Updates(map[string]any{"account_type": "business", "version": gorm.Expr("version + 1")}).Error; err != nil {
				return err
			}
		}
		action := "auth.staff_link"
		if remove {
			action = "auth.staff_unlink"
		}
		service := &Service{}
		return service.audit(ctx, tx, action, "succeeded", &user.ID)
	})
}
