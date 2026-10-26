package server

import (
	"log/slog"
	"net/http"

	"github.com/labstack/echo/v5"
	"github.com/labstack/echo/v5/middleware"
)

func New(logger *slog.Logger) *echo.Echo {
	e := echo.New()
	e.Logger = logger
	e.Use(middleware.RequestLogger())
	e.Use(middleware.Recover())
	e.GET("/api/health", func(c *echo.Context) error {
		return c.JSON(http.StatusOK, map[string]string{"status": "ok"})
	})
	return e
}
