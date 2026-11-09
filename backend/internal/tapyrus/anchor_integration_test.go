package tapyrus

import (
	"context"
	"github.com/nao317/mobile_tracer/backend/internal/config"
	"os"
	"strings"
	"testing"
	"time"
)

// Runs only against the explicitly mounted, isolated single-node dev chain.
func TestAnchorLive(t *testing.T) {
	if os.Getenv("TAPYRUS_INTEGRATION") != "1" {
		t.Skip("set TAPYRUS_INTEGRATION=1 with isolated dev chain")
	}
	cfg, err := config.LoadTapyrus()
	if err != nil {
		t.Fatal(err)
	}
	client := New(cfg)
	var chain struct {
		Mode string `json:"mode"`
	}
	if err = client.rpc(t.Context(), "getblockchaininfo", []any{}, &chain); err != nil {
		t.Fatal(err)
	}
	if chain.Mode != "dev" {
		t.Fatal("live anchor tests require dev mode")
	}
	hash := strings.Repeat("b", 64)
	raw, id, err := client.Prepare(t.Context(), hash)
	if err != nil {
		t.Fatal(err)
	}
	if raw == "" || !validHash(id) {
		t.Fatal("missing prepared transaction")
	}
	if err = client.Broadcast(t.Context(), raw); err != nil {
		t.Fatal(err)
	}
	keys, err := os.ReadFile("/chain/dev.keys")
	if err != nil {
		t.Fatal(err)
	}
	var key string
	for _, line := range strings.Split(string(keys), "\n") {
		if strings.HasPrefix(line, "private key: ") {
			key = strings.TrimPrefix(line, "private key: ")
		}
	}
	address, err := os.ReadFile("/chain/mining.address")
	if err != nil {
		t.Fatal(err)
	}
	if key == "" {
		t.Fatal("missing dev mining key")
	}
	var blocks []string
	if err = client.rpc(t.Context(), "generatetoaddress", []any{1, strings.TrimSpace(string(address)), key}, &blocks); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
	defer cancel()
	for {
		ok, err := client.Anchored(ctx, id, hash)
		if err == nil && ok {
			break
		}
		select {
		case <-ctx.Done():
			t.Fatal("anchor not indexed")
		case <-time.After(200 * time.Millisecond):
		}
	}
	if ok, err := client.Anchored(t.Context(), id, strings.Repeat("c", 64)); err == nil || ok {
		t.Fatal("wrong hash accepted")
	}
	_ = client.Broadcast(t.Context(), raw)
	if ok, err := client.Anchored(t.Context(), id, hash); err != nil || !ok {
		t.Fatal("rebroadcast lost original anchor")
	}
}
