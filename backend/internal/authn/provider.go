package authn

import (
	"context"
	firebase "firebase.google.com/go/v4"
	"firebase.google.com/go/v4/auth"
	"github.com/nao317/mobile_tracer/backend/internal/config"
	"time"
)

// The official SDK verifies signature, audience, issuer, expiry, disabled users and revocation.
type Provider interface {
	VerifyIDTokenAndCheckRevoked(context.Context, string) (*auth.Token, error)
	SessionCookie(context.Context, string, time.Duration) (string, error)
	VerifySessionCookieAndCheckRevoked(context.Context, string) (*auth.Token, error)
}

func Firebase(ctx context.Context, cfg config.Auth) (Provider, error) {
	app, err := firebase.NewApp(ctx, &firebase.Config{ProjectID: cfg.ProjectID})
	if err != nil {
		return nil, err
	}
	return app.Auth(ctx)
}
