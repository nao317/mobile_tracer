package database

import (
	"context"
	"database/sql"
	"errors"
	"net"
	"net/url"
	"strconv"
	"time"

	"github.com/nao317/mobile_tracer/backend/internal/config"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

type DB struct {
	GORM    *gorm.DB
	pool    *sql.DB
	timeout time.Duration
}

func Open(ctx context.Context, cfg config.Database) (*DB, error) {
	// URL encoding preserves passwords containing spaces, quotes, @, / or =.
	u := url.URL{
		Scheme: "postgres", Host: net.JoinHostPort(cfg.Host, strconv.Itoa(cfg.Port)),
		User: url.UserPassword(cfg.User, cfg.Password), Path: "/" + cfg.Name,
	}
	query := url.Values{"sslmode": {cfg.SSLMode}}
	u.RawQuery = query.Encode()
	orm, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{
		DisableAutomaticPing: true,
		// GORM initialization errors may include connection information.
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		return nil, errors.New("initialize PostgreSQL client failed")
	}
	pool, err := orm.DB()
	if err != nil {
		return nil, errors.New("get PostgreSQL connection pool failed")
	}
	pool.SetMaxOpenConns(cfg.MaxOpenConns)
	pool.SetMaxIdleConns(cfg.MaxIdleConns)
	pool.SetConnMaxLifetime(cfg.ConnMaxLifetime)
	db := &DB{GORM: orm, pool: pool, timeout: cfg.Timeout}
	if err := db.Ping(ctx); err != nil {
		_ = pool.Close()
		return nil, err
	}
	return db, nil
}

func (db *DB) Ping(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, db.timeout)
	defer cancel()
	if err := db.pool.PingContext(ctx); err != nil {
		// Driver errors can contain credentials or server-supplied details.
		return errors.New("PostgreSQL connection check failed")
	}
	return nil
}

func (db *DB) Close() error {
	return db.pool.Close()
}
