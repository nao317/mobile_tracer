package server

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/labstack/echo/v5"
	"github.com/labstack/echo/v5/middleware"
)

func New(logger *slog.Logger, readiness func(context.Context) error) *echo.Echo {
	e := echo.New()
	e.Logger = logger
	e.Use(middleware.RequestLogger())
	e.Use(middleware.Recover())
	e.GET("/api/health", func(c *echo.Context) error {
		return c.JSON(http.StatusOK, map[string]string{"status": "ok"})
	})
	e.GET("/api/ready", func(c *echo.Context) error {
		if readiness == nil {
			return c.JSON(http.StatusServiceUnavailable, map[string]string{"status": "unavailable"})
		}
		if err := readiness(c.Request().Context()); err != nil {
			logger.Warn("Tapyrus readiness check failed", "error", err)
			return c.JSON(http.StatusServiceUnavailable, map[string]string{"status": "unavailable"})
		}
		return c.JSON(http.StatusOK, map[string]string{"status": "ok"})
	})
	return e
}
