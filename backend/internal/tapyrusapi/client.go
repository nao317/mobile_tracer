// Package tapyrusapi connects to Chaintope's Timestamp V2 REST API.
// It never creates, funds, signs or broadcasts a Core RPC transaction.
package tapyrusapi

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/nao317/mobile_tracer/backend/internal/config"
)

const Prefix = "6d747261636572" // mtracer; fixed application namespace
var ErrMismatch = errors.New("timestamp content mismatch")
var ErrUncertain = errors.New("timestamp registration result uncertain")

type RejectedError struct{ Status int }

func (e *RejectedError) Error() string {
	return fmt.Sprintf("Tapyrus API rejected request (%d)", e.Status)
}

type Timestamp struct {
	ID          int64  `json:"id"`
	Version     string `json:"version"`
	Txid        string `json:"txid"`
	Status      string `json:"status"`
	ContentHash string `json:"content_hash"`
	Prefix      string `json:"prefix"`
	Type        string `json:"timestamp_type"`
	BlockHeight *int64 `json:"block_height"`
	BlockTime   *int64 `json:"block_time"`
}
type Client struct {
	origin, token string
	http          *http.Client
}

func New(c config.TapyrusAPI) (*Client, error) {
	pair, e := tls.LoadX509KeyPair(c.CertFile, c.KeyFile)
	if e != nil {
		return nil, fmt.Errorf("cannot load Tapyrus API client certificate")
	}
	token, e := os.ReadFile(c.TokenFile)
	if e != nil {
		return nil, fmt.Errorf("cannot read Tapyrus API token")
	}
	value := strings.TrimSpace(string(token))
	if value == "" || strings.ContainsAny(value, "\r\n") {
		return nil, fmt.Errorf("invalid Tapyrus API token")
	}
	roots, e := x509.SystemCertPool()
	if e != nil {
		roots = x509.NewCertPool()
	}
	if c.CAFile != "" {
		data, e := os.ReadFile(c.CAFile)
		if e != nil || !roots.AppendCertsFromPEM(data) {
			return nil, fmt.Errorf("cannot load Tapyrus API CA")
		}
	}
	return &Client{c.URL, value, &http.Client{Timeout: c.Timeout, Transport: &http.Transport{TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12, Certificates: []tls.Certificate{pair}, RootCAs: roots}}, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}
func validHash(v string) bool {
	b, e := hex.DecodeString(v)
	return e == nil && len(b) == 32 && v == strings.ToLower(v)
}
func Validate(t Timestamp, hash string) error {
	if t.ContentHash != hash || t.Prefix != Prefix || t.Type != "simple" {
		return ErrMismatch
	}
	// The published TimestampResponse status is init, unconfirmed or confirmed.
	if t.ID <= 0 || !validHash(t.Txid) || (t.Status != "confirmed" && t.Status != "unconfirmed" && t.Status != "init") {
		return ErrUncertain
	}
	if t.Status == "confirmed" && (t.BlockHeight == nil || t.BlockTime == nil) {
		return ErrUncertain
	}
	return nil
}
func (c *Client) request(ctx context.Context, method, path string, body any, result any) error {
	var data []byte
	var e error
	if body != nil {
		data, e = json.Marshal(body)
		if e != nil {
			return e
		}
	}
	req, e := http.NewRequestWithContext(ctx, method, c.origin+path, bytes.NewReader(data))
	if e != nil {
		return ErrUncertain
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	response, e := c.http.Do(req)
	if e != nil {
		return ErrUncertain
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK && response.StatusCode != http.StatusCreated {
		if response.StatusCode >= 400 && response.StatusCode < 500 && response.StatusCode != 408 {
			return &RejectedError{response.StatusCode}
		}
		return ErrUncertain
	}
	raw, e := io.ReadAll(io.LimitReader(response.Body, (8<<20)+1))
	if e != nil || len(raw) > 8<<20 {
		return ErrUncertain
	}
	if json.Unmarshal(raw, result) != nil {
		return ErrUncertain
	}
	return nil
}
func (c *Client) Create(ctx context.Context, hash string) (Timestamp, error) {
	var t Timestamp
	if !validHash(hash) {
		return t, ErrMismatch
	}
	e := c.request(ctx, "POST", "/api/v2/timestamps", map[string]string{"content": hash, "digest": "none", "type": "simple", "prefix": Prefix}, &t)
	if e != nil {
		return t, e
	}
	return t, Validate(t, hash)
}
func (c *Client) Get(ctx context.Context, id int64) (Timestamp, error) {
	var t Timestamp
	e := c.request(ctx, "GET", "/api/v2/timestamps/"+strconv.FormatInt(id, 10), nil, &t)
	if e == nil && t.ID != id {
		e = ErrUncertain
	}
	return t, e
}

// Find is recovery-only. Absence never authorizes another POST: the published
// API does not promise an idempotency key or a strongly consistent list result.
func (c *Client) Find(ctx context.Context, hash string) (*Timestamp, error) {
	var page struct {
		Count      int         `json:"count"`
		Timestamps []Timestamp `json:"timestamps"`
	}
	if e := c.request(ctx, "GET", "/api/v2/timestamps", nil, &page); e != nil {
		return nil, e
	}
	var found *Timestamp
	for _, t := range page.Timestamps {
		if t.ContentHash == hash && t.Prefix == Prefix && t.Type == "simple" {
			if e := Validate(t, hash); e != nil {
				return nil, e
			}
			if found != nil && found.ID != t.ID {
				return nil, ErrUncertain
			}
			copy := t
			found = &copy
		}
	}
	if found == nil {
		return nil, ErrUncertain
	}
	return found, nil
}
func (c *Client) Check(ctx context.Context) error {
	var page struct {
		Count int `json:"count"`
	}
	return c.request(ctx, "GET", "/api/v2/timestamps", nil, &page)
}
