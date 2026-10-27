package config

import (
	"errors"
	"net"
	"os"
	"strings"
)

func LoadTrustedProxies() ([]*net.IPNet, error) {
	value := strings.TrimSpace(os.Getenv("TRUSTED_PROXY_CIDRS"))
	if value == "" {
		return nil, nil
	}
	var ranges []*net.IPNet
	for _, cidr := range strings.Split(value, ",") {
		_, network, err := net.ParseCIDR(strings.TrimSpace(cidr))
		if err != nil {
			return nil, errors.New("TRUSTED_PROXY_CIDRS must be a comma-separated list of CIDRs")
		}
		ranges = append(ranges, network)
	}
	return ranges, nil
}
