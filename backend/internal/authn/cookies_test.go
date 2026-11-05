package authn

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/labstack/echo/v5"
	"github.com/nao317/mobile_tracer/backend/internal/config"
)

func TestProductionCookies(t *testing.T) {
	s := &Service{cfg: config.Auth{}}
	s.cfg.SecureCookies = true
	e := echo.New()
	e.GET("/", func(c *echo.Context) error {
		s.issueCookies(c, Session{ExpiresAt: time.Now().Add(time.Hour)}, "firebase-session", "csrf")
		return c.NoContent(204)
	})
	w := httptest.NewRecorder()
	e.ServeHTTP(w, httptest.NewRequest("GET", "https://app.example/", nil))
	cookies := w.Result().Cookies()
	if len(cookies) != 3 {
		t.Fatal("cookies missing")
	}
	for _, c := range cookies {
		if !c.Secure || c.Path != "/" || c.Domain != "" || c.SameSite != http.SameSiteLaxMode {
			t.Fatal("unsafe production cookie")
		}
		if c.Name != "__Host-mt_csrf" && !c.HttpOnly {
			t.Fatal("authentication cookie is readable by JS")
		}
	}
}
