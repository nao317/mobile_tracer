package server

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/labstack/echo/v5"
	"github.com/labstack/echo/v5/middleware"
)

func New(logger *slog.Logger, checks ...func(context.Context) error) *echo.Echo {
	e := echo.NewWithConfig(echo.Config{NoGroupAutoRegister404Routes: true})
	e.Logger = logger
	e.Use(middleware.RequestLogger())
	e.Use(middleware.Recover())
	e.GET("/api/health", func(c *echo.Context) error {
		return c.JSON(http.StatusOK, map[string]string{"status": "ok"})
	})
	e.GET("/api/ready", func(c *echo.Context) error {
		if len(checks) == 0 {
			return c.JSON(http.StatusServiceUnavailable, map[string]string{"status": "unavailable"})
		}
		for _, check := range checks {
			if check == nil {
				return c.JSON(http.StatusServiceUnavailable, map[string]string{"status": "unavailable"})
			}
			if err := check(c.Request().Context()); err != nil {
				logger.Warn("Dependency readiness check failed", "error", err)
				return c.JSON(http.StatusServiceUnavailable, map[string]string{"status": "unavailable"})
			}
		}
		return c.JSON(http.StatusOK, map[string]string{"status": "ok"})
	})
	return e
}
