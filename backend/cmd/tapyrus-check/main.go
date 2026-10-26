package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"

	"github.com/nao317/mobile_tracer/backend/internal/config"
	"github.com/nao317/mobile_tracer/backend/internal/tapyrus"
)

func main() {
	cfg, err := config.LoadTapyrus()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if cfg.RPCURL == "" {
		fmt.Fprintln(os.Stderr, "Tapyrus endpoints are not configured")
		os.Exit(1)
	}
	status, err := tapyrus.New(cfg).Check(context.Background())
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if err := json.NewEncoder(os.Stdout).Encode(status); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
