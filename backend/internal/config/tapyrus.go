package config

import (
	"fmt"
	"net/url"
	"os"
	"strings"
	"time"
)

type Tapyrus struct {
	RPCURL      string
	RPCUser     string
	RPCPassword string
	RESTURL     string
	Timeout     time.Duration
}

// LoadTapyrus allows the API to run alone when neither endpoint is configured.
func LoadTapyrus() (Tapyrus, error) {
	cfg := Tapyrus{
		RPCURL:      os.Getenv("TAPYRUS_RPC_URL"),
		RPCUser:     os.Getenv("TAPYRUS_RPC_USER"),
		RPCPassword: os.Getenv("TAPYRUS_RPC_PASSWORD"),
		RESTURL:     strings.TrimRight(os.Getenv("TAPYRUS_REST_URL"), "/"),
		Timeout:     5 * time.Second,
	}
	if value := os.Getenv("TAPYRUS_TIMEOUT"); value != "" {
		timeout, err := time.ParseDuration(value)
		if err != nil || timeout <= 0 {
			return Tapyrus{}, fmt.Errorf("TAPYRUS_TIMEOUT must be a positive duration")
		}
		cfg.Timeout = timeout
	}
	if cfg.RPCURL == "" && cfg.RESTURL == "" {
		return cfg, nil
	}
	for name, value := range map[string]string{"TAPYRUS_RPC_URL": cfg.RPCURL, "TAPYRUS_REST_URL": cfg.RESTURL} {
		parsed, err := url.Parse(value)
		if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
			return Tapyrus{}, fmt.Errorf("%s must be an HTTP(S) URL without credentials, query or fragment", name)
		}
	}
	if cfg.RPCUser == "" || cfg.RPCPassword == "" {
		return Tapyrus{}, fmt.Errorf("TAPYRUS_RPC_USER and TAPYRUS_RPC_PASSWORD are required")
	}
	return cfg, nil
}
