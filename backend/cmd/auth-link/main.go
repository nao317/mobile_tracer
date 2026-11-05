package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/nao317/mobile_tracer/backend/internal/authn"
	"github.com/nao317/mobile_tracer/backend/internal/config"
	"github.com/nao317/mobile_tracer/backend/internal/database"
)

func main() {
	subject := flag.String("firebase-uid", "", "Firebase Authentication UID (not email)")
	staff := flag.String("staff-id", "", "existing staff UUID")
	remove := flag.Bool("remove", false, "revoke the active link")
	flag.Parse()
	if err := run(*subject, *staff, *remove); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Println("Firebase identity / staff link updated.")
}
func run(subject, staff string, remove bool) error {
	cfg, err := config.LoadDatabase()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	db, err := database.Open(ctx, cfg)
	if err != nil {
		return err
	}
	defer db.Close()
	if err := authn.LinkStaff(ctx, db.GORM, os.Getenv("FIREBASE_PROJECT_ID"), subject, staff, remove); err != nil {
		return fmt.Errorf("identity link failed; verify FIREBASE_PROJECT_ID, firebase-uid, staff-id and database migration")
	}
	return nil
}
