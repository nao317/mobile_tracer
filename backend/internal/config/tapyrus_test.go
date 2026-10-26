package config

import (
	"testing"
	"time"
)

func TestLoadTapyrus(t *testing.T) {
	tests := []struct {
		name    string
		env     map[string]string
		wantErr bool
	}{
		{name: "disabled"},
		{name: "configured", env: map[string]string{"TAPYRUS_RPC_URL": "http://tapyrusd:12381", "TAPYRUS_REST_URL": "http://esplora:3000/", "TAPYRUS_RPC_USER": "user", "TAPYRUS_RPC_PASSWORD": "secret", "TAPYRUS_TIMEOUT": "2s"}},
		{name: "missing REST endpoint", env: map[string]string{"TAPYRUS_RPC_URL": "http://tapyrusd:12381"}, wantErr: true},
		{name: "missing RPC endpoint", env: map[string]string{"TAPYRUS_REST_URL": "http://esplora:3000"}, wantErr: true},
		{name: "missing credentials", env: map[string]string{"TAPYRUS_RPC_URL": "http://tapyrusd:12381", "TAPYRUS_REST_URL": "http://esplora:3000"}, wantErr: true},
		{name: "invalid URL scheme", env: map[string]string{"TAPYRUS_RPC_URL": "file:///tmp/rpc", "TAPYRUS_REST_URL": "http://esplora:3000"}, wantErr: true},
		{name: "credentials in URL", env: map[string]string{"TAPYRUS_RPC_URL": "http://user:secret@tapyrusd:12381", "TAPYRUS_REST_URL": "http://esplora:3000"}, wantErr: true},
		{name: "query in URL", env: map[string]string{"TAPYRUS_RPC_URL": "http://tapyrusd:12381?secret=value", "TAPYRUS_REST_URL": "http://esplora:3000"}, wantErr: true},
		{name: "invalid timeout", env: map[string]string{"TAPYRUS_TIMEOUT": "bad"}, wantErr: true},
		{name: "zero timeout", env: map[string]string{"TAPYRUS_TIMEOUT": "0s"}, wantErr: true},
		{name: "negative timeout", env: map[string]string{"TAPYRUS_TIMEOUT": "-1s"}, wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			for _, key := range []string{"TAPYRUS_RPC_URL", "TAPYRUS_REST_URL", "TAPYRUS_RPC_USER", "TAPYRUS_RPC_PASSWORD", "TAPYRUS_TIMEOUT"} {
				t.Setenv(key, tt.env[key])
			}
			got, err := LoadTapyrus()
			if (err != nil) != tt.wantErr {
				t.Fatalf("LoadTapyrus() error = %v, wantErr %v", err, tt.wantErr)
			}
			if tt.name == "disabled" && (got.RPCURL != "" || got.RESTURL != "" || got.Timeout != 5*time.Second) {
				t.Error("unexpected defaults")
			}
			if tt.name == "configured" && (got.RESTURL != "http://esplora:3000" || got.Timeout != 2*time.Second || got.RPCUser != "user" || got.RPCPassword != "secret") {
				t.Error("configured values were not loaded correctly")
			}
		})
	}
}
