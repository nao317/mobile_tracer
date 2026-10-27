package main

import (
	"context"
	"fmt"
	"os"

	"github.com/nao317/mobile_tracer/backend/db/seeds"
	"github.com/nao317/mobile_tracer/backend/internal/config"
	"github.com/nao317/mobile_tracer/backend/internal/database"
)

func run() error {
	if os.Getenv("APP_ENV") != "development" {
		return fmt.Errorf("development fixtures require APP_ENV=development")
	}
	cfg, err := config.LoadDatabase()
	if err != nil {
		return err
	}
	db, err := database.Open(context.Background(), cfg)
	if err != nil {
		return err
	}
	defer db.Close()
	return seeds.Apply(context.Background(), db.GORM)
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "Development fixture installation failed; verify APP_ENV, DB configuration and migrations.")
		os.Exit(1)
	}
	fmt.Println("Development fixtures are ready; existing fixtures were preserved.")
}
