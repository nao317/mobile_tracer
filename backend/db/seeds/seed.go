// Package seeds contains opt-in, fictional development fixtures.
package seeds

import (
	"context"
	_ "embed"

	"gorm.io/gorm"
)

//go:embed development.sql
var developmentSQL string

func Apply(ctx context.Context, db *gorm.DB) error {
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error { return tx.Exec(developmentSQL).Error })
}
