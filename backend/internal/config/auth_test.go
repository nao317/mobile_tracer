package config

import (
	"testing"
	"time"
)

func authEnv(t *testing.T) {
	t.Helper()
	for _, k := range []string{"AUTH_PUBLIC_URL", "FIREBASE_PROJECT_ID", "FIREBASE_API_KEY", "FIREBASE_AUTH_DOMAIN", "FIREBASE_APP_ID", "FIREBASE_AUTH_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_URL", "AUTH_SESSION_TTL", "SYSTEM_ADMIN_EMAILS"} {
		t.Setenv(k, "")
	}
	t.Setenv("APP_ENV", "production")
}
func validAuthEnv(t *testing.T) {
	authEnv(t)
	t.Setenv("AUTH_PUBLIC_URL", "https://app.example")
	t.Setenv("FIREBASE_PROJECT_ID", "mobile-tracer")
	t.Setenv("FIREBASE_API_KEY", "public-key")
	t.Setenv("FIREBASE_AUTH_DOMAIN", "mobile-tracer.firebaseapp.com")
	t.Setenv("FIREBASE_APP_ID", "app-id")
}
func TestAuthConfig(t *testing.T) {
	t.Run("disabled", func(t *testing.T) {
		authEnv(t)
		c, e := LoadAuth()
		if e != nil || c.Enabled {
			t.Fatal(e)
		}
	})
	t.Run("defaults", func(t *testing.T) {
		validAuthEnv(t)
		t.Setenv("SYSTEM_ADMIN_EMAILS", " ADMIN@example.com ")
		c, e := LoadAuth()
		if e != nil || !c.SecureCookies || c.SessionTTL != 5*24*time.Hour || !c.AdminEmails["admin@example.com"] {
			t.Fatalf("config: %v", e)
		}
	})
	for _, tc := range []struct{ key, value string }{
		{"AUTH_PUBLIC_URL", "http://localhost:8080"}, {"AUTH_PUBLIC_URL", "https://u:p@app.example"}, {"AUTH_PUBLIC_URL", "https://app.example/path"}, {"FIREBASE_PROJECT_ID", "bad/project"}, {"FIREBASE_API_KEY", ""}, {"FIREBASE_AUTH_DOMAIN", "https://app.example"}, {"AUTH_SESSION_TTL", "337h"}, {"AUTH_SESSION_TTL", "4m"}, {"SYSTEM_ADMIN_EMAILS", "Admin <a@example.com>"}, {"FIREBASE_AUTH_EMULATOR_HOST", "localhost:9099"},
	} {
		t.Run(tc.key+tc.value, func(t *testing.T) {
			validAuthEnv(t)
			t.Setenv(tc.key, tc.value)
			if _, e := LoadAuth(); e == nil {
				t.Fatal("unsafe config accepted")
			}
		})
	}
	t.Run("emulator development only", func(t *testing.T) {
		validAuthEnv(t)
		t.Setenv("APP_ENV", "development")
		t.Setenv("AUTH_PUBLIC_URL", "http://localhost:8080")
		t.Setenv("FIREBASE_PROJECT_ID", "demo-mobile-tracer")
		t.Setenv("FIREBASE_AUTH_EMULATOR_HOST", "localhost:9099")
		t.Setenv("FIREBASE_AUTH_EMULATOR_URL", "http://localhost:9099")
		if _, e := LoadAuth(); e != nil {
			t.Fatal(e)
		}
		t.Setenv("APP_ENV", "production")
		if _, e := LoadAuth(); e == nil {
			t.Fatal("emulator accepted in production")
		}
	})
}
