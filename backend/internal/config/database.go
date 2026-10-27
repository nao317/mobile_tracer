package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Database struct {
	Host            string
	Port            int
	Name            string
	User            string
	Password        string
	SSLMode         string
	Timeout         time.Duration
	MaxOpenConns    int
	MaxIdleConns    int
	ConnMaxLifetime time.Duration
}

func LoadDatabase() (Database, error) {
	cfg := Database{
		Host: "localhost", Port: 5432, SSLMode: "disable",
		Name: os.Getenv("POSTGRES_DB"), User: os.Getenv("POSTGRES_USER"),
		Password: os.Getenv("POSTGRES_PASSWORD"), Timeout: 3 * time.Second,
		MaxOpenConns: 10, MaxIdleConns: 2, ConnMaxLifetime: 30 * time.Minute,
	}
	for _, field := range []struct{ name, value string }{
		{"POSTGRES_DB", cfg.Name}, {"POSTGRES_USER", cfg.User}, {"POSTGRES_PASSWORD", cfg.Password},
	} {
		if strings.TrimSpace(field.value) == "" {
			return Database{}, fmt.Errorf("%s is required", field.name)
		}
	}
	if value := os.Getenv("DB_HOST"); value != "" {
		if strings.TrimSpace(value) == "" {
			return Database{}, fmt.Errorf("DB_HOST must not be blank")
		}
		cfg.Host = value
	}
	for _, field := range []struct {
		name string
		dest *int
		min  int
	}{
		{"DB_PORT", &cfg.Port, 1},
		{"DB_MAX_OPEN_CONNS", &cfg.MaxOpenConns, 1},
		{"DB_MAX_IDLE_CONNS", &cfg.MaxIdleConns, 0},
	} {
		if value := os.Getenv(field.name); value != "" {
			n, err := strconv.Atoi(value)
			if err != nil || n < field.min || (field.name == "DB_PORT" && n > 65535) {
				return Database{}, fmt.Errorf("%s is outside the allowed integer range", field.name)
			}
			*field.dest = n
		}
	}
	if cfg.MaxIdleConns > cfg.MaxOpenConns {
		return Database{}, fmt.Errorf("DB_MAX_IDLE_CONNS must not exceed DB_MAX_OPEN_CONNS")
	}
	for _, field := range []struct {
		name string
		dest *time.Duration
	}{
		{"DB_TIMEOUT", &cfg.Timeout},
		{"DB_CONN_MAX_LIFETIME", &cfg.ConnMaxLifetime},
	} {
		if value := os.Getenv(field.name); value != "" {
			d, err := time.ParseDuration(value)
			if err != nil || d <= 0 {
				return Database{}, fmt.Errorf("%s must be a positive duration", field.name)
			}
			*field.dest = d
		}
	}
	if value := os.Getenv("DB_SSLMODE"); value != "" {
		switch value {
		case "disable", "allow", "prefer", "require", "verify-ca", "verify-full":
			cfg.SSLMode = value
		default:
			return Database{}, fmt.Errorf("DB_SSLMODE must be a PostgreSQL SSL mode")
		}
	}
	return cfg, nil
}
