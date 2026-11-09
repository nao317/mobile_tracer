package tapyrus

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

var ErrAnchorMismatch = errors.New("chain anchor mismatch")

// Prepare never broadcasts. Callers must commit the signed bytes and immutable
// Tapyrus txid before Broadcast, so an ambiguous response can safely be retried.
func (c *Client) Prepare(ctx context.Context, hash string) (string, string, error) {
	if !validHash(hash) {
		return "", "", fmt.Errorf("invalid anchor hash")
	}
	var raw string
	if err := c.rpc(ctx, "createrawtransaction", []any{[]any{}, map[string]string{"data": hash}}, &raw); err != nil {
		return "", "", err
	}
	var funded struct {
		Hex string `json:"hex"`
	}
	if err := c.walletRPC(ctx, "fundrawtransaction", []any{raw, map[string]any{"lockUnspents": true}}, &funded); err != nil {
		return "", "", err
	}
	var signed struct {
		Hex      string `json:"hex"`
		Complete bool   `json:"complete"`
	}
	if err := c.walletRPC(ctx, "signrawtransactionwithwallet", []any{funded.Hex}, &signed); err != nil {
		return "", "", err
	}
	if !signed.Complete {
		return "", "", fmt.Errorf("transaction signing incomplete")
	}
	var decoded struct {
		Txid string `json:"txid"`
	}
	if err := c.rpc(ctx, "decoderawtransaction", []any{signed.Hex}, &decoded); err != nil {
		return "", "", err
	}
	if !validHash(decoded.Txid) {
		return "", "", fmt.Errorf("invalid immutable txid")
	}
	return signed.Hex, decoded.Txid, nil
}
func (c *Client) Broadcast(ctx context.Context, raw string) error {
	var id string
	return c.rpc(ctx, "sendrawtransaction", []any{raw}, &id)
}

// Anchored checks the actual indexed OP_RETURN output and block confirmation,
// not a locally stored transaction ID or a simulated success flag.
func (c *Client) Anchored(ctx context.Context, id, hash string) (bool, error) {
	if !validHash(id) || !validHash(hash) {
		return false, fmt.Errorf("invalid hash")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.cfg.RESTURL+"/tx/"+id, nil)
	if err != nil {
		return false, err
	}
	response, err := c.http.Do(req)
	if err != nil {
		return false, err
	}
	defer response.Body.Close()
	if response.StatusCode == 404 {
		return false, nil
	}
	if response.StatusCode != 200 {
		return false, fmt.Errorf("index unavailable")
	}
	var tx struct {
		Txid string `json:"txid"`
		Vout []struct {
			Script string `json:"scriptpubkey"`
		} `json:"vout"`
		Status struct {
			Confirmed bool `json:"confirmed"`
		} `json:"status"`
	}
	if err = json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&tx); err != nil {
		return false, err
	}
	if tx.Txid != id {
		return false, ErrAnchorMismatch
	}
	for _, out := range tx.Vout {
		if out.Script == "6a20"+hash {
			return tx.Status.Confirmed, nil
		}
	}
	return false, ErrAnchorMismatch
}

func (c *Client) walletRPC(ctx context.Context, method string, params []any, result any) error {
	cfg := c.cfg
	if cfg.Wallet != "" && !strings.Contains(cfg.RPCURL, "/wallet/") {
		cfg.RPCURL = strings.TrimRight(cfg.RPCURL, "/") + "/wallet/" + url.PathEscape(cfg.Wallet)
	}
	wallet := &Client{cfg: cfg, http: c.http}
	return wallet.rpc(ctx, method, params, result)
}
