package database

import (
	"context"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/nao317/mobile_tracer/backend/internal/config"
	"github.com/nao317/mobile_tracer/backend/internal/server"
)

func TestOpenHandshakeTimeout(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	done := make(chan struct{})
	defer close(done)
	go func() {
		conn, err := listener.Accept()
		if err == nil {
			defer conn.Close()
			<-done // Accept TCP but never answer the PostgreSQL handshake.
		}
	}()
	port := listener.Addr().(*net.TCPAddr).Port
	cfg := config.Database{
		Host: "127.0.0.1", Port: port, Name: "test", User: "test", Password: "private-secret",
		SSLMode: "disable", Timeout: 50 * time.Millisecond, MaxOpenConns: 1,
	}
	started := time.Now()
	db, err := Open(context.Background(), cfg)
	if err == nil || db != nil {
		t.Fatal("startup succeeded without a PostgreSQL handshake")
	}
	if time.Since(started) > 2*time.Second {
		t.Fatal("database startup did not respect the timeout")
	}
	if strings.Contains(err.Error(), cfg.Password) {
		t.Fatal("password leaked in connection error")
	}
}

// TEST_DATABASE=1 enables checks against an actual PostgreSQL server in CI or locally.
func TestPostgres(t *testing.T) {
	if os.Getenv("TEST_DATABASE") != "1" {
		t.Skip("set TEST_DATABASE=1 and configure POSTGRES_* to test PostgreSQL")
	}
	cfg, err := config.LoadDatabase()
	if err != nil {
		t.Fatal(err)
	}
	cfg.MaxOpenConns, cfg.MaxIdleConns = 1, 1
	db, err := Open(t.Context(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	var value int
	if err := db.GORM.WithContext(t.Context()).Raw("SELECT 1").Scan(&value).Error; err != nil || value != 1 {
		t.Fatal("GORM could not query PostgreSQL")
	}
	if db.pool.Stats().MaxOpenConnections != 1 {
		t.Fatal("connection pool limit was not applied")
	}
	ready := server.New(slog.New(slog.NewJSONHandler(io.Discard, nil)), db.Ping, func(context.Context) error { return nil })
	assertStatus := func(path string, status int) {
		t.Helper()
		rec := httptest.NewRecorder()
		ready.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if rec.Code != status {
			t.Fatalf("%s returned %d, want %d", path, rec.Code, status)
		}
	}
	assertStatus("/api/ready", http.StatusOK)
	// Occupying the only connection must not leave a readiness request blocked.
	conn, err := db.pool.Conn(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Millisecond)
	started := time.Now()
	err = db.Ping(ctx)
	cancel()
	_ = conn.Close()
	if err == nil || time.Since(started) > time.Second {
		t.Fatal("connection pool wait did not respect request cancellation")
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	assertStatus("/api/ready", http.StatusServiceUnavailable)
	assertStatus("/api/health", http.StatusOK)

	bad := cfg
	bad.Password = "incorrect-password-" + strconv.FormatInt(time.Now().UnixNano(), 10)
	if opened, err := Open(t.Context(), bad); err == nil || opened != nil {
		t.Fatal("database startup accepted an invalid password")
	} else if strings.Contains(err.Error(), bad.Password) {
		t.Fatal("password leaked in authentication error")
	}
}
