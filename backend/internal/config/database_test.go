package config

import (
	"strings"
	"testing"
	"time"
)

func TestLoadDatabase(t *testing.T) {
	keys := []string{
		"POSTGRES_DB", "POSTGRES_USER", "POSTGRES_PASSWORD", "DB_HOST", "DB_PORT",
		"DB_SSLMODE", "DB_TIMEOUT", "DB_MAX_OPEN_CONNS", "DB_MAX_IDLE_CONNS", "DB_CONN_MAX_LIFETIME",
	}
	for _, tt := range []struct {
		name string
		env  map[string]string
		err  string
	}{
		{name: "defaults"},
		{name: "custom", env: map[string]string{
			"DB_HOST": "db", "DB_PORT": "5433", "DB_SSLMODE": "verify-full", "DB_TIMEOUT": "500ms",
			"DB_MAX_OPEN_CONNS": "4", "DB_MAX_IDLE_CONNS": "0", "DB_CONN_MAX_LIFETIME": "1m",
		}},
		{name: "missing database", env: map[string]string{"POSTGRES_DB": ""}, err: "POSTGRES_DB"},
		{name: "missing user", env: map[string]string{"POSTGRES_USER": ""}, err: "POSTGRES_USER"},
		{name: "missing password", env: map[string]string{"POSTGRES_PASSWORD": ""}, err: "POSTGRES_PASSWORD"},
		{name: "blank password", env: map[string]string{"POSTGRES_PASSWORD": "  "}, err: "POSTGRES_PASSWORD"},
		{name: "blank host", env: map[string]string{"DB_HOST": " "}, err: "DB_HOST"},
		{name: "invalid port", env: map[string]string{"DB_PORT": "secret-invalid-value"}, err: "DB_PORT"},
		{name: "zero port", env: map[string]string{"DB_PORT": "0"}, err: "DB_PORT"},
		{name: "large port", env: map[string]string{"DB_PORT": "65536"}, err: "DB_PORT"},
		{name: "invalid SSL mode", env: map[string]string{"DB_SSLMODE": "secret-invalid-value"}, err: "DB_SSLMODE"},
		{name: "invalid timeout", env: map[string]string{"DB_TIMEOUT": "soon"}, err: "DB_TIMEOUT"},
		{name: "zero timeout", env: map[string]string{"DB_TIMEOUT": "0s"}, err: "DB_TIMEOUT"},
		{name: "negative timeout", env: map[string]string{"DB_TIMEOUT": "-1s"}, err: "DB_TIMEOUT"},
		{name: "unlimited connections", env: map[string]string{"DB_MAX_OPEN_CONNS": "0"}, err: "DB_MAX_OPEN_CONNS"},
		{name: "invalid idle count", env: map[string]string{"DB_MAX_IDLE_CONNS": "-1"}, err: "DB_MAX_IDLE_CONNS"},
		{name: "idle exceeds open", env: map[string]string{"DB_MAX_OPEN_CONNS": "1"}, err: "DB_MAX_IDLE_CONNS"},
		{name: "zero lifetime", env: map[string]string{"DB_CONN_MAX_LIFETIME": "0s"}, err: "DB_CONN_MAX_LIFETIME"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			for _, key := range keys {
				t.Setenv(key, "")
			}
			t.Setenv("POSTGRES_DB", "mobile_tracer")
			t.Setenv("POSTGRES_USER", "mobiletracer")
			t.Setenv("POSTGRES_PASSWORD", "p@ss /'\\?=#")
			for key, value := range tt.env {
				t.Setenv(key, value)
			}
			cfg, err := LoadDatabase()
			if tt.err != "" {
				if err == nil || !strings.Contains(err.Error(), tt.err) {
					t.Fatalf("expected validation error for %s", tt.err)
				}
				if strings.Contains(err.Error(), "secret-invalid-value") || strings.Contains(err.Error(), "p@ss") {
					t.Fatal("configuration value leaked in error")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			want := Database{
				Host: "localhost", Port: 5432, Name: "mobile_tracer", User: "mobiletracer",
				Password: "p@ss /'\\?=#", SSLMode: "disable", Timeout: 3 * time.Second,
				MaxOpenConns: 10, MaxIdleConns: 2, ConnMaxLifetime: 30 * time.Minute,
			}
			if tt.name == "custom" {
				want.Host, want.Port, want.SSLMode = "db", 5433, "verify-full"
				want.Timeout, want.MaxOpenConns, want.MaxIdleConns, want.ConnMaxLifetime = 500*time.Millisecond, 4, 0, time.Minute
			}
			if cfg != want {
				t.Fatal("loaded database configuration differs from expected values")
			}
		})
	}
}
