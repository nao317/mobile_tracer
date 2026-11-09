package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/nao317/mobile_tracer/backend/internal/authn"
	"github.com/nao317/mobile_tracer/backend/internal/business"
	"github.com/nao317/mobile_tracer/backend/internal/config"
	"github.com/nao317/mobile_tracer/backend/internal/database"
	"github.com/nao317/mobile_tracer/backend/internal/server"
	"github.com/nao317/mobile_tracer/backend/internal/tapyrusapi"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	cfg, err := config.Load()
	if err != nil {
		logger.Error("invalid configuration", "error", err)
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, cfg, logger); err != nil {
		logger.Error("API server failed", "error", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, cfg config.Config, logger *slog.Logger) (runErr error) {
	apiAuth, err := config.LoadBusinessAuth()
	if err != nil {
		return err
	}
	identityCfg, err := config.LoadAuth()
	if err != nil {
		return err
	}
	proxies, err := config.LoadTrustedProxies()
	if err != nil {
		return err
	}
	timestampCfg, err := config.LoadTapyrusAPI()
	if err != nil {
		return err
	}
	var timestampClient *tapyrusapi.Client
	if timestampCfg.URL != "" {
		timestampClient, err = tapyrusapi.New(timestampCfg)
		if err != nil {
			return err
		}
	}
	dbCfg, err := config.LoadDatabase()
	if err != nil {
		return err
	}
	db, err := database.Open(ctx, dbCfg)
	if err != nil {
		return err
	}
	defer func() {
		runErr = errors.Join(runErr, db.Close())
	}()
	checks := []func(context.Context) error{db.Ping}
	if timestampClient != nil {
		checks = append(checks, timestampClient.Check)
	}
	e := server.New(logger, checks...)
	var provider authn.Provider
	if identityCfg.Enabled {
		provider, err = authn.Firebase(ctx, identityCfg)
		if err != nil {
			return fmt.Errorf("initialize Firebase Authentication: %w", err)
		}
	}
	listener, err := net.Listen("tcp", net.JoinHostPort("", cfg.Port))
	if err != nil {
		return fmt.Errorf("listen: %w", err)
	}
	identities := authn.New(db.GORM, identityCfg, provider, logger)
	server.RegisterBusiness(e, business.New(db.GORM), apiAuth, identities)
	identities.Register(e)
	identities.RegisterWorkflow(e)
	identities.RegisterCasework(e)
	if timestampClient != nil {
		identities.StartTimestampWorkflow(ctx, timestampClient, timestampCfg.URL)
	}
	server.ConfigureProxy(e, proxies)
	srv := &http.Server{
		Handler:           e,
		ReadHeaderTimeout: 5 * time.Second,
	}
	serveErr := make(chan error, 1)
	go func() {
		serveErr <- srv.Serve(listener)
	}()
	logger.Info("API server started", "address", listener.Addr().String())

	select {
	case err := <-serveErr:
		return fmt.Errorf("serve: %w", err)
	case <-ctx.Done():
		logger.Info("shutting down API server")
	}

	// The signal context is already canceled; allow active requests time to finish.
	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		_ = srv.Close()
		return fmt.Errorf("shutdown: %w", err)
	}
	if err := <-serveErr; !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("serve: %w", err)
	}
	logger.Info("API server stopped")
	return nil
}
