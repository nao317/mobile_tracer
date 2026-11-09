package authn_test

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"firebase.google.com/go/v4/auth"
	"github.com/labstack/echo/v5"
	"github.com/nao317/mobile_tracer/backend/db/seeds"
	"github.com/nao317/mobile_tracer/backend/internal/authn"
	"github.com/nao317/mobile_tracer/backend/internal/business"
	"github.com/nao317/mobile_tracer/backend/internal/config"
	"github.com/nao317/mobile_tracer/backend/internal/database"
	"github.com/nao317/mobile_tracer/backend/internal/server"
	"gorm.io/gorm"
)

func uid(n int) string { return fmt.Sprintf("00000000-0000-0000-0000-%012d", n) }
func authDB(t *testing.T) *gorm.DB {
	t.Helper()
	if os.Getenv("TEST_DATABASE") != "1" {
		t.Skip("set TEST_DATABASE=1 for isolated PostgreSQL tests")
	}
	cfg, err := config.LoadDatabase()
	if err != nil {
		t.Fatal(err)
	}
	admin, err := database.Open(t.Context(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = admin.Close() })
	var suffix [8]byte
	if _, err := rand.Read(suffix[:]); err != nil {
		t.Fatal(err)
	}
	name := "auth_test_" + hex.EncodeToString(suffix[:])
	if err := admin.GORM.Exec(`CREATE DATABASE "` + name + `"`).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := admin.GORM.Exec(`DROP DATABASE "` + name + `" WITH (FORCE)`).Error; err != nil {
			t.Error(err)
		}
	})
	cfg.Name = name
	db, err := database.Open(t.Context(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	files, err := filepath.Glob("../../db/migrations/*.up.sql")
	if err != nil || len(files) == 0 {
		t.Fatal("migrations missing")
	}
	for _, file := range files {
		sql, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		if err := db.GORM.Transaction(func(tx *gorm.DB) error { return tx.Exec(string(sql)).Error }); err != nil {
			t.Fatalf("migration %s: %v", file, err)
		}
	}
	if err := seeds.Apply(t.Context(), db.GORM); err != nil {
		t.Fatal(err)
	}
	return db.GORM
}

type fakeFirebase struct {
	identity         auth.Token
	invalid, revoked bool
	sequence         int
	sessions         map[string]auth.Token
}

func (p *fakeFirebase) VerifyIDTokenAndCheckRevoked(_ context.Context, raw string) (*auth.Token, error) {
	if p.invalid || raw != "firebase-id-token-secret" {
		return nil, errors.New("provider-error-secret")
	}
	v := p.identity
	return &v, nil
}
func (p *fakeFirebase) SessionCookie(_ context.Context, _ string, _ time.Duration) (string, error) {
	p.sequence++
	token := fmt.Sprintf("firebase-cookie-secret-%d", p.sequence)
	p.sessions[token] = p.identity
	return token, nil
}
func (p *fakeFirebase) VerifySessionCookieAndCheckRevoked(_ context.Context, raw string) (*auth.Token, error) {
	v, ok := p.sessions[raw]
	if p.revoked || !ok {
		return nil, errors.New("revoked")
	}
	return &v, nil
}

type safeLog struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (b *safeLog) Write(p []byte) (int, error) { b.mu.Lock(); defer b.mu.Unlock(); return b.b.Write(p) }
func (b *safeLog) String() string              { b.mu.Lock(); defer b.mu.Unlock(); return b.b.String() }

type rig struct {
	t        *testing.T
	db       *gorm.DB
	e        *echo.Echo
	provider *fakeFirebase
	cfg      config.Auth
	logs     *safeLog
	service  *authn.Service
}
type jar map[string]*http.Cookie

func newRig(t *testing.T) *rig {
	t.Helper()
	cfg := config.Auth{Enabled: true, PublicURL: "http://app.example", ProjectID: "demo-mobile-tracer", SessionTTL: time.Hour, AdminEmails: map[string]bool{"admin@example.com": true}}
	db := authDB(t)
	p := &fakeFirebase{identity: auth.Token{UID: "firebase-staff", Issuer: cfg.FirebaseIssuer(), AuthTime: time.Now().Unix(), Claims: map[string]interface{}{"email": "staff@example.com", "email_verified": true}}, sessions: map[string]auth.Token{}}
	logs := &safeLog{}
	logger := slog.New(slog.NewJSONHandler(logs, nil))
	e := server.New(logger)
	service := authn.New(db, cfg, p, logger)
	server.RegisterBusiness(e, business.New(db), config.BusinessAuth{Environment: "production"}, service)
	service.Register(e)
	service.RegisterWorkflow(e)
	service.RegisterCasework(e)
	return &rig{t, db, e, p, cfg, logs, service}
}
func (h *rig) call(method, path, body string, cookies jar, modify func(*http.Request)) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, h.cfg.PublicURL+path, strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	for _, c := range cookies {
		r.AddCookie(c)
	}
	if method == "POST" || method == "PUT" || method == "PATCH" {
		r.Header.Set("Origin", h.cfg.PublicURL)
		if c := cookies["mt_csrf"]; c != nil {
			r.Header.Set("X-CSRF-Token", c.Value)
		}
	}
	if modify != nil {
		modify(r)
	}
	w := httptest.NewRecorder()
	h.e.ServeHTTP(w, r)
	return w
}
func (h *rig) expect(w *httptest.ResponseRecorder, status int) {
	h.t.Helper()
	if w.Code != status {
		h.t.Fatalf("status %d want %d: %s", w.Code, status, w.Body.String())
	}
}
func merge(j jar, w *httptest.ResponseRecorder) jar {
	copy := jar{}
	for k, v := range j {
		copy[k] = v
	}
	for _, c := range w.Result().Cookies() {
		if c.MaxAge < 0 {
			delete(copy, c.Name)
		} else {
			copy[c.Name] = c
		}
	}
	return copy
}
func (h *rig) begin() (jar, string) {
	h.t.Helper()
	w := h.call("GET", "/api/auth/login-challenge", "", nil, nil)
	h.expect(w, 200)
	var body struct {
		Data struct {
			CSRFToken string `json:"csrf_token"`
		}
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		h.t.Fatal(err)
	}
	return merge(nil, w), body.Data.CSRFToken
}
func (h *rig) finish(j jar, csrf string) *httptest.ResponseRecorder {
	return h.call("POST", "/api/auth/session", `{"id_token":"firebase-id-token-secret"}`, j, func(r *http.Request) { r.Header.Set("X-CSRF-Token", csrf) })
}
func (h *rig) login(staffs ...int) jar {
	h.t.Helper()
	for _, staff := range staffs {
		if err := authn.LinkStaff(h.t.Context(), h.db, h.cfg.ProjectID, h.provider.identity.UID, uid(staff), false); err != nil {
			h.t.Fatal(err)
		}
	}
	j, csrf := h.begin()
	w := h.finish(j, csrf)
	h.expect(w, 200)
	return merge(j, w)
}
func (h *rig) exec(query string, args ...any) {
	h.t.Helper()
	if err := h.db.Exec(query, args...).Error; err != nil {
		h.t.Fatal(err)
	}
}
func TestAuthPostgres(t *testing.T) {
	t.Run("registered account and tenant context", func(t *testing.T) {
		h := newRig(t)
		j := h.login(101)
		w := h.call("GET", "/api/context", "", j, nil)
		h.expect(w, 200)
		if !strings.Contains(w.Body.String(), uid(101)) || !strings.Contains(w.Body.String(), "tenant_admin") {
			t.Fatal(w.Body.String())
		}
		if !j["mt_session"].HttpOnly {
			t.Fatal("unsafe session cookie")
		}
		var rawCount int64
		if err := h.db.Table("auth.sessions").Where("token_hash=?", j["mt_session"].Value).Count(&rawCount).Error; err != nil || rawCount != 0 {
			t.Fatal("raw token stored")
		}
		if strings.Contains(h.logs.String(), j["mt_session"].Value) {
			t.Fatal("credential in logs")
		}

	})
	t.Run("unregistered general user has no business access and email does not link", func(t *testing.T) {
		h := newRig(t)
		h.provider.identity.Claims["email"] = "admin-a@example.invalid"
		j := h.login()
		h.expect(h.call("GET", "/api/auth/me", "", j, nil), 200)
		h.expect(h.call("GET", "/api/context", "", j, nil), 403)
		var count int64
		h.db.Table("auth.staff_links").Count(&count)
		if count != 0 {
			t.Fatal("email auto-linked")
		}
	})
	for _, kind := range []string{"staff", "tenant", "user", "link"} {
		t.Run("stopped "+kind, func(t *testing.T) {
			h := newRig(t)
			j := h.login(101)
			switch kind {
			case "staff":
				h.exec("UPDATE app.staff_members SET status='suspended' WHERE id=?", uid(101))
			case "tenant":
				h.exec("UPDATE app.tenants SET status='suspended' WHERE id=?", uid(1))
			case "user":
				h.exec("UPDATE auth.users SET status='suspended'")
			case "link":
				if err := authn.LinkStaff(t.Context(), h.db, h.cfg.ProjectID, h.provider.identity.UID, uid(101), true); err != nil {
					t.Fatal(err)
				}
			}
			w := h.call("GET", "/api/context", "", j, nil)
			if w.Code != 401 && w.Code != 403 {
				t.Fatal(w.Code)
			}
		})
	}
	t.Run("role revocation takes effect immediately", func(t *testing.T) {
		h := newRig(t)
		j := h.login(101)
		h.expect(h.call("GET", "/api/context", "", j, nil), 200)
		h.exec("UPDATE app.staff_role_assignments SET revoked_by=?,revoked_at=now() WHERE staff_id=? AND revoked_at IS NULL", uid(101), uid(101))
		h.expect(h.call("GET", "/api/context", "", j, nil), 403)
	})
	t.Run("tenant selection is restricted to active links", func(t *testing.T) {
		h := newRig(t)
		j := h.login(101, 201)
		h.expect(h.call("GET", "/api/context", "", j, nil), 403)
		h.expect(h.call("POST", "/api/auth/membership", `{"staff_id":"`+uid(102)+`"}`, j, nil), 403)
		h.expect(h.call("POST", "/api/auth/membership", `{"staff_id":"`+uid(201)+`"}`, j, nil), 200)
		w := h.call("GET", "/api/context", "", j, nil)
		h.expect(w, 200)
		if !strings.Contains(w.Body.String(), uid(201)) {
			t.Fatal(w.Body.String())
		}
		h.expect(h.call("GET", "/api/vehicles/"+uid(3001), "", j, nil), 404)
	})
	t.Run("store and assignment access remain scoped", func(t *testing.T) {
		h := newRig(t)
		j := h.login(103)
		h.expect(h.call("GET", "/api/cases/"+uid(5001), "", j, nil), 200)
		h.expect(h.call("GET", "/api/cases/"+uid(5002), "", j, nil), 404)
		h.expect(h.call("GET", "/api/cases/"+uid(6001), "", j, nil), 404)
	})
	t.Run("logout revokes Firebase session immediately", func(t *testing.T) {
		h := newRig(t)
		j := h.login(101)
		h.expect(h.call("POST", "/api/auth/logout", "", j, nil), 200)
		h.expect(h.call("GET", "/api/context", "", j, nil), 401)
	})
	t.Run("csrf required for writes logout and tenant selection", func(t *testing.T) {
		h := newRig(t)
		j := h.login(101)
		for _, path := range []string{"/api/vehicles", "/api/auth/logout", "/api/auth/membership"} {
			h.expect(h.call("POST", path, `{}`, j, func(r *http.Request) { r.Header.Del("X-CSRF-Token") }), 403)
			h.expect(h.call("POST", path, `{}`, j, func(r *http.Request) { r.Header.Set("Origin", "https://evil.example") }), 403)
		}
		h.expect(h.call("GET", "/api/context", "", j, nil), 200)
	})
	t.Run("system administrator is checked on the server", func(t *testing.T) {
		h := newRig(t)
		j := h.login()
		h.expect(h.call("GET", "/api/admin/context", "", j, nil), 403)
		h.provider.identity.Claims["email"] = "admin@example.com"
		admin := h.login()
		h.expect(h.call("GET", "/api/admin/context", "", admin, nil), 200)
		h.expect(h.call("GET", "/api/context", "", admin, nil), 403)
		h.provider.revoked = true
		h.expect(h.call("GET", "/api/admin/context", "", admin, nil), 401)
	})
	for _, kind := range []string{"signature", "issuer", "unverified", "stale", "future", "uid", "challenge", "browser", "origin", "replay"} {
		t.Run("invalid login "+kind, func(t *testing.T) {
			h := newRig(t)
			j, csrf := h.begin()
			want := 401
			switch kind {
			case "signature":
				h.provider.invalid = true
			case "issuer":
				h.provider.identity.Issuer = "https://evil.example"
			case "unverified":
				h.provider.identity.Claims["email_verified"] = false
			case "stale":
				h.provider.identity.AuthTime = time.Now().Add(-6 * time.Minute).Unix()
			case "future":
				h.provider.identity.AuthTime = time.Now().Add(time.Minute).Unix()
			case "uid":
				h.provider.identity.UID = ""
			case "challenge":
				csrf = "invalid-challenge-at-least-thirty-two-chars"
				want = 403
			case "browser":
				j["mt_login"].Value = "different-browser"
				want = 403
			case "origin":
				w := h.call("POST", "/api/auth/session", `{"id_token":"firebase-id-token-secret"}`, j, func(r *http.Request) {
					r.Header.Set("X-CSRF-Token", csrf)
					r.Header.Set("Origin", "https://evil.example")
				})
				h.expect(w, 403)
				return
			case "replay":
				h.expect(h.finish(j, csrf), 200)
				want = 403
			}
			w := h.finish(j, csrf)
			h.expect(w, want)
			if strings.Contains(w.Body.String()+h.logs.String(), "provider-error-secret") {
				t.Fatal("provider secret leaked")
			}
		})
	}
	t.Run("Firebase revocation and tampering rejected", func(t *testing.T) {
		h := newRig(t)
		j := h.login(101)
		h.provider.revoked = true
		h.expect(h.call("GET", "/api/context", "", j, nil), 401)
		h.provider.revoked = false
		j["mt_session"].Value += "tamper"
		h.expect(h.call("GET", "/api/context", "", j, nil), 401)
		h.expect(h.call("GET", "/api/context", "", j, func(r *http.Request) { r.Header.Set("Authorization", "Bearer development-token") }), 401)
	})
	t.Run("response never returns credentials", func(t *testing.T) {
		h := newRig(t)
		j := h.login()
		w := h.call("GET", "/api/auth/me", "", j, nil)
		h.expect(w, 200)
		var body map[string]any
		if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if strings.Contains(w.Body.String(), j["mt_session"].Value) {
			t.Fatal("tokens in JSON")
		}
	})
}
