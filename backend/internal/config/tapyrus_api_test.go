package config

import "testing"

func TestTapyrusAPIConfiguration(t *testing.T) {
	for _, test := range []struct {
		name   string
		values map[string]string
		bad    bool
	}{{"disabled", nil, false}, {"https and credentials", map[string]string{"TAPYRUS_API_URL": "https://app.api.tapyrus.chaintope.com", "TAPYRUS_API_TOKEN_FILE": "/run/tapyrus-api/token", "TAPYRUS_API_CERT_FILE": "/run/tapyrus-api/client.crt", "TAPYRUS_API_KEY_FILE": "/run/tapyrus-api/client.key"}, false}, {"missing credentials", map[string]string{"TAPYRUS_API_URL": "https://app.example"}, true}, {"no endpoint", map[string]string{"TAPYRUS_API_TOKEN_FILE": "/token"}, true}, {"unsafe HTTP", map[string]string{"TAPYRUS_API_URL": "http://app.example"}, true}, {"path", map[string]string{"TAPYRUS_API_URL": "https://app.example/api/v2"}, true}} {
		t.Run(test.name, func(t *testing.T) {
			for _, key := range []string{"TAPYRUS_API_URL", "TAPYRUS_API_TOKEN_FILE", "TAPYRUS_API_CERT_FILE", "TAPYRUS_API_KEY_FILE", "TAPYRUS_API_CA_FILE", "TAPYRUS_API_TIMEOUT"} {
				t.Setenv(key, "")
			}
			for k, v := range test.values {
				t.Setenv(k, v)
			}
			_, e := LoadTapyrusAPI()
			if (e != nil) != test.bad {
				t.Fatalf("unexpected config result: %v", e)
			}
		})
	}
}
