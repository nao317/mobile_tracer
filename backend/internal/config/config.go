package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

type Config struct {
	Port            string
	ShutdownTimeout time.Duration
}

func Load() (Config, error) {
	cfg := Config{Port: "8080", ShutdownTimeout: 10 * time.Second}
	if value := os.Getenv("PORT"); value != "" {
		port, err := strconv.Atoi(value)
		if err != nil || port < 1 || port > 65535 {
			return Config{}, fmt.Errorf("PORT must be an integer between 1 and 65535")
		}
		cfg.Port = strconv.Itoa(port)
	}
	if value := os.Getenv("SHUTDOWN_TIMEOUT"); value != "" {
		timeout, err := time.ParseDuration(value)
		if err != nil || timeout <= 0 {
			return Config{}, fmt.Errorf("SHUTDOWN_TIMEOUT must be a positive duration, for example 10s")
		}
		cfg.ShutdownTimeout = timeout
	}
	return cfg, nil
}
