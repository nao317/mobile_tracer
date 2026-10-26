package tapyrus

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/nao317/mobile_tracer/backend/internal/config"
)

type Client struct {
	cfg  config.Tapyrus
	http *http.Client
}

type Status struct {
	Network       string `json:"network"`
	Mode          string `json:"mode"`
	Height        int64  `json:"height"`
	GenesisHash   string `json:"genesis_hash"`
	BestBlockHash string `json:"best_block_hash"`
}

func New(cfg config.Tapyrus) *Client {
	return &Client{cfg: cfg, http: &http.Client{
		Timeout: cfg.Timeout,
		// Do not forward RPC credentials through redirects.
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}}
}

// Check requires both services to agree on the genesis and current chain tip.
func (c *Client) Check(ctx context.Context) (Status, error) {
	ctx, cancel := context.WithTimeout(ctx, c.cfg.Timeout)
	defer cancel()
	var chain struct {
		Network       string `json:"chain"`
		Mode          string `json:"mode"`
		Blocks        int64  `json:"blocks"`
		BestBlockHash string `json:"bestblockhash"`
		InitialSync   bool   `json:"initialblockdownload"`
	}
	if err := c.rpc(ctx, "getblockchaininfo", []any{}, &chain); err != nil {
		return Status{}, err
	}
	if chain.InitialSync || chain.Network == "" || !validHash(chain.BestBlockHash) {
		return Status{}, fmt.Errorf("Tapyrus chain is not ready")
	}
	var genesis string
	if err := c.rpc(ctx, "getblockhash", []any{0}, &genesis); err != nil {
		return Status{}, err
	}
	restGenesis, err := c.rest(ctx, "/block-height/0")
	if err != nil {
		return Status{}, err
	}
	if !validHash(genesis) || genesis != restGenesis {
		return Status{}, fmt.Errorf("Tapyrus Core and Esplora genesis blocks differ")
	}
	tip, err := c.rest(ctx, "/blocks/tip/hash")
	if err != nil {
		return Status{}, err
	}
	if tip != chain.BestBlockHash {
		return Status{}, fmt.Errorf("Esplora has not indexed the current Tapyrus chain tip")
	}
	return Status{Network: chain.Network, Mode: chain.Mode, Height: chain.Blocks, GenesisHash: genesis, BestBlockHash: tip}, nil
}

func (c *Client) rpc(ctx context.Context, method string, params []any, result any) error {
	body, err := json.Marshal(map[string]any{"jsonrpc": "1.0", "id": 1, "method": method, "params": params})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.cfg.RPCURL, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create Tapyrus RPC request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.SetBasicAuth(c.cfg.RPCUser, c.cfg.RPCPassword)
	data, err := c.do(req, "Tapyrus RPC")
	if err != nil {
		return err
	}
	var response struct {
		Result json.RawMessage `json:"result"`
		Error  *struct {
			Code int `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(data, &response); err != nil {
		return fmt.Errorf("invalid Tapyrus RPC response: %w", err)
	}
	if response.Error != nil {
		return fmt.Errorf("Tapyrus RPC %s failed with code %d", method, response.Error.Code)
	}
	if len(response.Result) == 0 || string(response.Result) == "null" {
		return fmt.Errorf("Tapyrus RPC %s returned no result", method)
	}
	if err := json.Unmarshal(response.Result, result); err != nil {
		return fmt.Errorf("decode Tapyrus RPC result: %w", err)
	}
	return nil
}

func (c *Client) rest(ctx context.Context, path string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.cfg.RESTURL+path, nil)
	if err != nil {
		return "", fmt.Errorf("create Esplora request: %w", err)
	}
	data, err := c.do(req, "Esplora")
	return strings.TrimSpace(string(data)), err
}

func (c *Client) do(req *http.Request, service string) ([]byte, error) {
	response, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%s request failed: %w", service, err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%s returned HTTP %d", service, response.StatusCode)
	}
	const limit = 1 << 20
	data, err := io.ReadAll(io.LimitReader(response.Body, limit+1))
	if err != nil {
		return nil, fmt.Errorf("read %s response: %w", service, err)
	}
	if len(data) > limit {
		return nil, fmt.Errorf("%s response exceeds size limit", service)
	}
	return data, nil
}

func validHash(value string) bool {
	if len(value) != 64 {
		return false
	}
	for _, ch := range value {
		if !strings.ContainsRune("0123456789abcdef", ch) {
			return false
		}
	}
	return true
}
