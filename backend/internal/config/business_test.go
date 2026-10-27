package config

import "testing"

func TestBusinessAuth(t *testing.T) {
	for _, tt := range []struct {
		name, environment, token, staff string
		valid                           bool
	}{
		{"disabled by default", "", "", "", true},
		{"development disabled", "development", "", "", true},
		{"development enabled", "development", "development-token-at-least-32-characters", "00000000-0000-0000-0000-000000000101", true},
		{"production rejected", "production", "development-token-at-least-32-characters", "00000000-0000-0000-0000-000000000101", false},
		{"implicit production rejected", "", "development-token-at-least-32-characters", "00000000-0000-0000-0000-000000000101", false},
		{"test rejected", "test", "development-token-at-least-32-characters", "00000000-0000-0000-0000-000000000101", false},
		{"short token", "development", "short", "00000000-0000-0000-0000-000000000101", false},
		{"missing staff", "development", "development-token-at-least-32-characters", "", false},
		{"missing token", "development", "", "00000000-0000-0000-0000-000000000101", false},
		{"invalid environment", "prod", "", "", false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("APP_ENV", tt.environment)
			t.Setenv("DEV_AUTH_TOKEN", tt.token)
			t.Setenv("DEV_AUTH_STAFF_ID", tt.staff)
			_, err := LoadBusinessAuth()
			if (err == nil) != tt.valid {
				t.Fatalf("valid=%t error=%v", tt.valid, err)
			}
		})
	}
}
