package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v5"
)

func TestHealth(t *testing.T) {
	var logs bytes.Buffer
	e := New(slog.New(slog.NewJSONHandler(&logs, nil)), nil)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/health", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	contentType, _, err := mime.ParseMediaType(rec.Header().Get("Content-Type"))
	if err != nil || contentType != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", rec.Header().Get("Content-Type"))
	}
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode health response: %v", err)
	}
	if len(body) != 1 || body["status"] != "ok" {
		t.Errorf("body = %v, want {status:ok}", body)
	}
	entry := requestLogForURI(t, logs.Bytes(), "/api/health")
	if entry.Method != http.MethodGet || entry.URI != "/api/health" || entry.Status != http.StatusOK {
		t.Errorf("unexpected request log: %+v", entry)
	}
}

func TestRecover(t *testing.T) {
	var logs bytes.Buffer
	e := New(slog.New(slog.NewJSONHandler(&logs, nil)), nil)
	e.GET("/panic", func(c *echo.Context) error {
		panic("test panic")
	})
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/panic", nil))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusInternalServerError)
	}
	if bytes.Contains(rec.Body.Bytes(), []byte("test panic")) {
		t.Errorf("panic details leaked in response: %s", rec.Body.String())
	}
	entry := requestLogForURI(t, logs.Bytes(), "/panic")
	if entry.Status != http.StatusInternalServerError || entry.Error == "" {
		t.Errorf("unexpected panic request log: %+v", entry)
	}
	health := httptest.NewRecorder()
	e.ServeHTTP(health, httptest.NewRequest(http.MethodGet, "/api/health", nil))
	if health.Code != http.StatusOK {
		t.Errorf("health after panic = %d, want %d", health.Code, http.StatusOK)
	}
}

type requestLogEntry struct {
	Method string `json:"method"`
	URI    string `json:"uri"`
	Status int    `json:"status"`
	Error  string `json:"error"`
}

func requestLogForURI(t *testing.T, logs []byte, uri string) requestLogEntry {
	t.Helper()
	decoder := json.NewDecoder(bytes.NewReader(logs))
	for {
		var entry requestLogEntry
		if err := decoder.Decode(&entry); err == io.EOF {
			t.Fatalf("no request log for %s", uri)
		} else if err != nil {
			t.Fatalf("decode request log: %v", err)
		}
		if entry.URI == uri {
			return entry
		}
	}
}

func TestRequestLogForURIWithMultipleRecords(t *testing.T) {
	logs := []byte(`{"msg":"panic recovered","error":"test panic"}
{"method":"GET","uri":"/api/health","status":200}
{"method":"GET","uri":"/panic","status":500,"error":"test panic"}
{"msg":"another log record"}
`)
	entry := requestLogForURI(t, logs, "/panic")
	if entry.Method != http.MethodGet || entry.URI != "/panic" || entry.Status != http.StatusInternalServerError || entry.Error != "test panic" {
		t.Errorf("unexpected panic request log: %+v", entry)
	}
}

func TestReadiness(t *testing.T) {
	for _, tt := range []struct {
		name  string
		check func(context.Context) error
		want  int
	}{
		{name: "not configured", want: http.StatusServiceUnavailable},
		{name: "ready", check: func(context.Context) error { return nil }, want: http.StatusOK},
		{name: "unavailable", check: func(context.Context) error { return errors.New("dependency failed") }, want: http.StatusServiceUnavailable},
	} {
		t.Run(tt.name, func(t *testing.T) {
			e := New(slog.New(slog.NewJSONHandler(io.Discard, nil)), tt.check)
			rec := httptest.NewRecorder()
			e.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/ready", nil))
			if rec.Code != tt.want {
				t.Errorf("readiness status = %d, want %d", rec.Code, tt.want)
			}
			if bytes.Contains(rec.Body.Bytes(), []byte("dependency failed")) {
				t.Error("dependency details leaked to public response")
			}
			health := httptest.NewRecorder()
			e.ServeHTTP(health, httptest.NewRequest(http.MethodGet, "/api/health", nil))
			if health.Code != http.StatusOK {
				t.Error("liveness must work even when Tapyrus is unavailable")
			}
		})
	}
}
