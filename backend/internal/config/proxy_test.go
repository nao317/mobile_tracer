package config

import "testing"

func TestLoadTrustedProxies(t *testing.T) {
	for _, tt := range []struct {
		value string
		count int
		bad   bool
	}{
		{"", 0, false},
		{"  ", 0, false},
		{"172.16.0.0/12, 10.0.0.0/8,fc00::/7", 3, false},
		{"172.16.0.0/12,", 0, true},
		{"not-a-network", 0, true},
		{"192.168.1.1", 0, true},
	} {
		t.Run(tt.value, func(t *testing.T) {
			t.Setenv("TRUSTED_PROXY_CIDRS", tt.value)
			ranges, err := LoadTrustedProxies()
			if (err != nil) != tt.bad || len(ranges) != tt.count {
				t.Fatalf("loaded %d ranges, error = %v", len(ranges), err)
			}
		})
	}
}
