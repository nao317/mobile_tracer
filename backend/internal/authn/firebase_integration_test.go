package authn_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"firebase.google.com/go/v4/auth"
	"github.com/nao317/mobile_tracer/backend/internal/authn"
	"github.com/nao317/mobile_tracer/backend/internal/business"
	"github.com/nao317/mobile_tracer/backend/internal/config"
	"github.com/nao317/mobile_tracer/backend/internal/server"
)

// Uses the actual Firebase Admin SDK and Authentication Emulator, with no cloud accounts.
func TestFirebaseEmulator(t *testing.T) {
	host := os.Getenv("FIREBASE_AUTH_EMULATOR_HOST")
	if host == "" {
		t.Skip("set FIREBASE_AUTH_EMULATOR_HOST for official Firebase SDK integration")
	}
	projectID := os.Getenv("FIREBASE_TEST_PROJECT_ID")
	if projectID == "" {
		projectID = "demo-mobile-tracer"
	}
	cfg := config.Auth{Enabled: true, PublicURL: "http://app.example", ProjectID: projectID, SessionTTL: time.Hour, AdminEmails: map[string]bool{}}
	provider, err := authn.Firebase(t.Context(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	client := provider.(*auth.Client)
	for _, kind := range []string{"password", "google.com"} {
		t.Run(kind, func(t *testing.T) {
			email := fmt.Sprintf("firebase-%s-%s@company.example", strings.ReplaceAll(kind, ".", "-"), strings.ReplaceAll(t.Name(), "/", "-"))
			// Unique test databases are independent, and emulator fixtures are unique per run.
			email = fmt.Sprintf("%d-%s", time.Now().UnixNano(), email)
			user, err := client.CreateUser(t.Context(), (&auth.UserToCreate{}).Email(email).EmailVerified(true).Password("test-password-123!"))
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = client.DeleteUser(t.Context(), user.UID) })
			endpoint := "signInWithPassword"
			body := map[string]any{"email": email, "password": "test-password-123!", "returnSecureToken": true}
			if kind == "google.com" {
				endpoint = "signInWithIdp"
				// The emulator accepts a JSON Google assertion and issues its own Firebase token.
				assertion, _ := json.Marshal(map[string]any{"sub": "google-" + user.UID, "email": email, "email_verified": true})
				values := url.Values{"providerId": {"google.com"}, "id_token": {string(assertion)}}
				body = map[string]any{"postBody": values.Encode(), "requestUri": "http://localhost", "returnSecureToken": true}
			}
			data, _ := json.Marshal(body)
			response, err := http.Post("http://"+host+"/identitytoolkit.googleapis.com/v1/accounts:"+endpoint+"?key=demo-api-key", "application/json", bytes.NewReader(data))
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			var result struct {
				IDToken string `json:"idToken"`
				LocalID string `json:"localId"`
				Error   any    `json:"error"`
			}
			if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
				t.Fatal(err)
			}
			if response.StatusCode != 200 || result.IDToken == "" {
				t.Fatalf("Firebase sign-in failed: HTTP %d", response.StatusCode)
			}
			db := authDB(t)
			if err := authn.LinkStaff(t.Context(), db, cfg.ProjectID, result.LocalID, uid(101), false); err != nil {
				t.Fatal(err)
			}
			e := server.New(slog.Default())
			service := authn.New(db, cfg, provider, slog.Default())
			service.Register(e)
			server.RegisterBusiness(e, business.New(db), config.BusinessAuth{Environment: "production"}, service)
			h := &rig{t: t, db: db, e: e, cfg: cfg}
			j, csrf := h.begin()
			bodyJSON, _ := json.Marshal(map[string]string{"id_token": result.IDToken})
			w := h.call("POST", "/api/auth/session", string(bodyJSON), j, func(r *http.Request) { r.Header.Set("X-CSRF-Token", csrf) })
			h.expect(w, 200)
			j = merge(j, w)
			h.expect(h.call("GET", "/api/context", "", j, nil), 200)
			h.expect(h.call("POST", "/api/auth/logout", "", j, nil), 200)
			h.expect(h.call("GET", "/api/context", "", j, nil), 401)
			// A fresh session is also denied immediately when Firebase disables the user.
			j, csrf = h.begin()
			w = h.call("POST", "/api/auth/session", string(bodyJSON), j, func(r *http.Request) { r.Header.Set("X-CSRF-Token", csrf) })
			h.expect(w, 200)
			j = merge(j, w)
			if _, err := client.UpdateUser(t.Context(), result.LocalID, (&auth.UserToUpdate{}).Disabled(true)); err != nil {
				t.Fatal(err)
			}
			h.expect(h.call("GET", "/api/context", "", j, nil), 401)
		})
	}
}
