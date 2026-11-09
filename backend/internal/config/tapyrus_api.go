package config

import (
	"fmt"
	"net/url"
	"os"
	"strings"
	"time"
)

type TapyrusAPI struct {
	URL, TokenFile, CertFile, KeyFile, CAFile string
	Timeout                                   time.Duration
}

func LoadTapyrusAPI() (TapyrusAPI, error) {
	c := TapyrusAPI{URL: strings.TrimRight(os.Getenv("TAPYRUS_API_URL"), "/"), TokenFile: os.Getenv("TAPYRUS_API_TOKEN_FILE"), CertFile: os.Getenv("TAPYRUS_API_CERT_FILE"), KeyFile: os.Getenv("TAPYRUS_API_KEY_FILE"), CAFile: os.Getenv("TAPYRUS_API_CA_FILE"), Timeout: 10 * time.Second}
	if c.URL == "" {
		if c.TokenFile != "" || c.CertFile != "" || c.KeyFile != "" || c.CAFile != "" {
			return c, fmt.Errorf("TAPYRUS_API_URL is required when API credentials are configured")
		}
		return c, nil
	}
	u, e := url.Parse(c.URL)
	if e != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" {
		return c, fmt.Errorf("TAPYRUS_API_URL must be an HTTPS origin without path or credentials")
	}
	if c.TokenFile == "" || c.CertFile == "" || c.KeyFile == "" {
		return c, fmt.Errorf("Tapyrus API requires token, client certificate and private key files")
	}
	if v := os.Getenv("TAPYRUS_API_TIMEOUT"); v != "" {
		c.Timeout, e = time.ParseDuration(v)
		if e != nil || c.Timeout <= 0 || c.Timeout > time.Minute {
			return c, fmt.Errorf("invalid TAPYRUS_API_TIMEOUT")
		}
	}
	return c, nil
}
