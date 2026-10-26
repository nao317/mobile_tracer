package server

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"mime"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v5"
)

func TestHealth(t *testing.T) {
	var logs bytes.Buffer
	e := New(slog.New(slog.NewJSONHandler(&logs, nil)))
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
	var entry struct {
		Method string `json:"method"`
		URI    string `json:"uri"`
		Status int    `json:"status"`
	}
	if err := json.Unmarshal(logs.Bytes(), &entry); err != nil {
		t.Fatalf("decode request log: %v", err)
	}
	if entry.Method != http.MethodGet || entry.URI != "/api/health" || entry.Status != http.StatusOK {
		t.Errorf("unexpected request log: %+v", entry)
	}
}

func TestRecover(t *testing.T) {
	var logs bytes.Buffer
	e := New(slog.New(slog.NewJSONHandler(&logs, nil)))
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
	var entry struct {
		Status int    `json:"status"`
		Error  string `json:"error"`
	}
	if err := json.Unmarshal(logs.Bytes(), &entry); err != nil {
		t.Fatalf("decode panic request log: %v", err)
	}
	if entry.Status != http.StatusInternalServerError || entry.Error == "" {
		t.Errorf("unexpected panic request log: %+v", entry)
	}
	health := httptest.NewRecorder()
	e.ServeHTTP(health, httptest.NewRequest(http.MethodGet, "/api/health", nil))
	if health.Code != http.StatusOK {
		t.Errorf("health after panic = %d, want %d", health.Code, http.StatusOK)
	}
}
