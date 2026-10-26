package config

import (
	"testing"
	"time"
)

func TestLoad(t *testing.T) {
	tests := []struct {
		name    string
		port    string
		timeout string
		want    Config
		wantErr bool
	}{
		{name: "defaults", want: Config{Port: "8080", ShutdownTimeout: 10 * time.Second}},
		{name: "custom values", port: "9000", timeout: "3s", want: Config{Port: "9000", ShutdownTimeout: 3 * time.Second}},
		{name: "minimum port", port: "1", want: Config{Port: "1", ShutdownTimeout: 10 * time.Second}},
		{name: "maximum port", port: "65535", want: Config{Port: "65535", ShutdownTimeout: 10 * time.Second}},
		{name: "non-numeric port", port: "http", wantErr: true},
		{name: "zero port", port: "0", wantErr: true},
		{name: "negative port", port: "-1", wantErr: true},
		{name: "port out of range", port: "65536", wantErr: true},
		{name: "invalid duration", timeout: "soon", wantErr: true},
		{name: "missing duration unit", timeout: "10", wantErr: true},
		{name: "zero duration", timeout: "0s", wantErr: true},
		{name: "negative duration", timeout: "-1s", wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("PORT", tt.port)
			t.Setenv("SHUTDOWN_TIMEOUT", tt.timeout)
			got, err := Load()
			if (err != nil) != tt.wantErr {
				t.Fatalf("Load() error = %v, wantErr %v", err, tt.wantErr)
			}
			if !tt.wantErr && got != tt.want {
				t.Errorf("Load() = %+v, want %+v", got, tt.want)
			}
		})
	}
}
