package server

import (
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v5"
)

func TestForwardedRequestMetadata(t *testing.T) {
	_, network, err := net.ParseCIDR("172.20.0.0/24")
	if err != nil {
		t.Fatal(err)
	}
	for _, tt := range []struct {
		name, peer, wantIP, wantScheme string
		ranges                         []*net.IPNet
	}{
		{"trusted proxy", "172.20.0.2:1234", "198.51.100.20", "https", []*net.IPNet{network}},
		{"untrusted private peer", "172.21.0.2:1234", "172.21.0.2", "http", []*net.IPNet{network}},
		{"untrusted public peer", "203.0.113.10:1234", "203.0.113.10", "http", []*net.IPNet{network}},
		{"standalone", "127.0.0.1:1234", "127.0.0.1", "http", nil},
	} {
		t.Run(tt.name, func(t *testing.T) {
			e := New(slog.New(slog.NewJSONHandler(io.Discard, nil)))
			ConfigureProxy(e, tt.ranges)
			e.GET("/probe", func(c *echo.Context) error {
				if c.RealIP() != tt.wantIP || c.Scheme() != tt.wantScheme {
					t.Errorf("IP=%s scheme=%s, want IP=%s scheme=%s", c.RealIP(), c.Scheme(), tt.wantIP, tt.wantScheme)
				}
				if c.Request().Host != "mobile-tracer.local:8080" || c.QueryParam("value") != "a/b" {
					t.Error("host or query string changed")
				}
				return c.NoContent(http.StatusOK)
			})
			req := httptest.NewRequest(http.MethodGet, "/probe?value=a%2Fb", nil)
			req.RemoteAddr, req.Host = tt.peer, "mobile-tracer.local:8080"
			req.Header.Set("X-Real-IP", "198.51.100.20")
			req.Header.Set("X-Forwarded-Proto", "https")
			e.ServeHTTP(httptest.NewRecorder(), req)
		})
	}
}
