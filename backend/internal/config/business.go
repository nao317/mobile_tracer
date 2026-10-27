package config

import (
	"fmt"
	"os"
	"regexp"
	"strings"
)

// BusinessAuth is disabled by default. A production identity provider can replace
// this development-only authentication without trusting tenant IDs from clients.
type BusinessAuth struct {
	Environment string
	Token       string
	StaffID     string
}

func LoadBusinessAuth() (BusinessAuth, error) {
	cfg := BusinessAuth{Environment: os.Getenv("APP_ENV"), Token: os.Getenv("DEV_AUTH_TOKEN"), StaffID: strings.ToLower(os.Getenv("DEV_AUTH_STAFF_ID"))}
	if cfg.Environment == "" {
		cfg.Environment = "production"
	}
	if cfg.Environment != "production" && cfg.Environment != "development" && cfg.Environment != "test" {
		return BusinessAuth{}, fmt.Errorf("APP_ENV must be production, development or test")
	}
	if cfg.Token == "" && cfg.StaffID == "" {
		return cfg, nil
	}
	if cfg.Environment != "development" {
		return BusinessAuth{}, fmt.Errorf("development authentication requires APP_ENV=development")
	}
	if len(cfg.Token) < 32 || strings.ContainsAny(cfg.Token, " \t\r\n") {
		return BusinessAuth{}, fmt.Errorf("DEV_AUTH_TOKEN must contain at least 32 non-whitespace bytes")
	}
	if !regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`).MatchString(cfg.StaffID) {
		return BusinessAuth{}, fmt.Errorf("DEV_AUTH_STAFF_ID must be a UUID")
	}
	return cfg, nil
}
