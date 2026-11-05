package config

import (
	"fmt"
	"net/mail"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"
)

type Auth struct {
	Enabled                                                      bool
	PublicURL, ProjectID, APIKey, AuthDomain, AppID, EmulatorURL string
	SessionTTL                                                   time.Duration
	SecureCookies                                                bool
	AdminEmails                                                  map[string]bool
}

func (c Auth) FirebaseIssuer() string { return "https://securetoken.google.com/" + c.ProjectID }
func LoadAuth() (Auth, error) {
	c := Auth{PublicURL: strings.TrimSuffix(os.Getenv("AUTH_PUBLIC_URL"), "/"), ProjectID: os.Getenv("FIREBASE_PROJECT_ID"), APIKey: os.Getenv("FIREBASE_API_KEY"), AuthDomain: os.Getenv("FIREBASE_AUTH_DOMAIN"), AppID: os.Getenv("FIREBASE_APP_ID"), EmulatorURL: os.Getenv("FIREBASE_AUTH_EMULATOR_URL"), SessionTTL: 5 * 24 * time.Hour, AdminEmails: map[string]bool{}}
	admins := os.Getenv("SYSTEM_ADMIN_EMAILS")
	emulator := os.Getenv("FIREBASE_AUTH_EMULATOR_HOST")
	if c.PublicURL+c.ProjectID+c.APIKey+c.AuthDomain+c.AppID+c.EmulatorURL+admins+emulator+os.Getenv("AUTH_SESSION_TTL") == "" {
		return c, nil
	}
	c.Enabled = true
	u, err := url.Parse(c.PublicURL)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" || u.Opaque != "" {
		return Auth{}, fmt.Errorf("AUTH_PUBLIC_URL must be an HTTP(S) origin")
	}
	c.SecureCookies = u.Scheme == "https"
	env := os.Getenv("APP_ENV")
	local := env == "development" || env == "test"
	if !c.SecureCookies && (u.Scheme != "http" || !local || !loopback(u.Hostname())) {
		return Auth{}, fmt.Errorf("AUTH_PUBLIC_URL requires HTTPS except for loopback development or test")
	}
	if !regexp.MustCompile(`^[a-z][a-z0-9-]{4,62}$`).MatchString(c.ProjectID) || c.APIKey == "" || c.AuthDomain == "" || c.AppID == "" {
		return Auth{}, fmt.Errorf("FIREBASE_PROJECT_ID, FIREBASE_API_KEY, FIREBASE_AUTH_DOMAIN and FIREBASE_APP_ID are required")
	}
	if strings.ContainsAny(c.AuthDomain, "/: \t\r\n") {
		return Auth{}, fmt.Errorf("FIREBASE_AUTH_DOMAIN must be a hostname")
	}
	if emulator != "" || c.EmulatorURL != "" {
		eu, e := url.Parse(c.EmulatorURL)
		if !local || !strings.HasPrefix(c.ProjectID, "demo-") || emulator == "" || strings.Contains(emulator, "://") || e != nil || eu.Scheme != "http" || !loopback(eu.Hostname()) || eu.User != nil || eu.Path != "" || eu.RawQuery != "" || eu.Fragment != "" {
			return Auth{}, fmt.Errorf("Firebase emulator requires a demo- project, a loopback HTTP URL and development/test APP_ENV; never use it in production")
		}
	}
	if v := os.Getenv("AUTH_SESSION_TTL"); v != "" {
		d, e := time.ParseDuration(v)
		if e != nil || d < 5*time.Minute || d > 14*24*time.Hour {
			return Auth{}, fmt.Errorf("AUTH_SESSION_TTL must be between 5m and 336h")
		}
		c.SessionTTL = d
	}
	for _, v := range strings.Split(admins, ",") {
		v = strings.ToLower(strings.TrimSpace(v))
		if v == "" {
			continue
		}
		a, e := mail.ParseAddress(v)
		if e != nil || a.Address != v {
			return Auth{}, fmt.Errorf("SYSTEM_ADMIN_EMAILS must contain email addresses")
		}
		c.AdminEmails[v] = true
	}
	return c, nil
}
func loopback(host string) bool { return host == "localhost" || host == "127.0.0.1" || host == "::1" }
