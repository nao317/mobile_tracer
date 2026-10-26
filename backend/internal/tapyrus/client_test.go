package tapyrus

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/nao317/mobile_tracer/backend/internal/config"
)

func TestCheck(t *testing.T) {
	genesis := strings.Repeat("a", 64)
	tip := strings.Repeat("b", 64)
	tests := []struct {
		name    string
		failure string
		wantErr string
	}{
		{name: "ready"},
		{name: "RPC authentication rejected", failure: "unauthorized", wantErr: "HTTP 401"},
		{name: "RPC error", failure: "rpc-error", wantErr: "code -28"},
		{name: "invalid JSON", failure: "invalid-json", wantErr: "invalid Tapyrus RPC response"},
		{name: "missing result", failure: "no-result", wantErr: "returned no result"},
		{name: "chain still syncing", failure: "syncing", wantErr: "chain is not ready"},
		{name: "wrong network", failure: "genesis", wantErr: "genesis blocks differ"},
		{name: "index behind", failure: "tip", wantErr: "not indexed"},
		{name: "REST unavailable", failure: "rest-error", wantErr: "Esplora returned HTTP 503"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			service := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/" {
					user, password, ok := r.BasicAuth()
					if !ok || user != "user" || password != "secret" || r.Method != http.MethodPost {
						t.Error("RPC request has wrong authentication or method")
					}
					switch tt.failure {
					case "unauthorized":
						w.WriteHeader(http.StatusUnauthorized)
						return
					case "rpc-error":
						fmt.Fprint(w, `{"result":null,"error":{"code":-28,"message":"loading"},"id":1}`)
						return
					case "invalid-json":
						fmt.Fprint(w, "not JSON")
						return
					case "no-result":
						fmt.Fprint(w, `{"result":null,"error":null,"id":1}`)
						return
					}
					var request struct {
						Method string `json:"method"`
						Params []any  `json:"params"`
					}
					if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
						t.Error(err)
						return
					}
					var result any
					switch request.Method {
					case "getblockchaininfo":
						result = map[string]any{"chain": "1905960821", "mode": "dev", "blocks": 101, "bestblockhash": tip, "initialblockdownload": tt.failure == "syncing"}
					case "getblockhash":
						if len(request.Params) != 1 || request.Params[0] != float64(0) {
							t.Error("genesis must be requested at height zero")
						}
						result = genesis
					default:
						t.Errorf("unexpected RPC method %s", request.Method)
					}
					_ = json.NewEncoder(w).Encode(map[string]any{"result": result, "error": nil, "id": 1})
					return
				}
				if r.Method != http.MethodGet || r.Header.Get("Authorization") != "" {
					t.Error("REST must use GET without RPC credentials")
				}
				if tt.failure == "rest-error" {
					w.WriteHeader(http.StatusServiceUnavailable)
					return
				}
				switch r.URL.Path {
				case "/block-height/0":
					if tt.failure == "genesis" {
						fmt.Fprint(w, tip)
					} else {
						fmt.Fprintln(w, genesis)
					}
				case "/blocks/tip/hash":
					if tt.failure == "tip" {
						fmt.Fprint(w, genesis)
					} else {
						fmt.Fprint(w, tip)
					}
				default:
					t.Errorf("unexpected path %s", r.URL.Path)
				}
			}))
			defer service.Close()
			client := New(config.Tapyrus{RPCURL: service.URL, RESTURL: service.URL, RPCUser: "user", RPCPassword: "secret", Timeout: time.Second})
			status, err := client.Check(context.Background())
			if tt.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
					t.Fatalf("error = %v, want %s", err, tt.wantErr)
				}
				if strings.Contains(err.Error(), "secret") {
					t.Error("credentials leaked in error")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if status.Network != "1905960821" || status.Mode != "dev" || status.Height != 101 || status.GenesisHash != genesis || status.BestBlockHash != tip {
				t.Errorf("unexpected chain status: %+v", status)
			}
		})
	}
}

func TestCheckTimeoutAndCancellation(t *testing.T) {
	service := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		select {
		case <-r.Context().Done():
		case <-time.After(time.Second):
		}
	}))
	defer service.Close()
	client := New(config.Tapyrus{RPCURL: service.URL, Timeout: 20 * time.Millisecond})
	_, err := client.Check(context.Background())
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("timeout error = %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = client.Check(ctx)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation error = %v", err)
	}
}

func TestCheckConnectionFailure(t *testing.T) {
	service := httptest.NewServer(http.NotFoundHandler())
	service.Close()
	_, err := New(config.Tapyrus{RPCURL: service.URL, Timeout: time.Second}).Check(context.Background())
	if err == nil || !strings.Contains(err.Error(), "request failed") {
		t.Fatalf("connection error = %v", err)
	}
}
