package authn

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	firebase "firebase.google.com/go/v4"
	"google.golang.org/api/option"
)

type transportFunc func(*http.Request) (*http.Response, error)

func (f transportFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestFirebaseProductionVerification(t *testing.T) {
	t.Setenv("FIREBASE_AUTH_EMULATOR_HOST", "")
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	cert := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "test-only"}, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour)}
	der, err := x509.CreateCertificate(rand.Reader, cert, cert, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	keys, _ := json.Marshal(map[string]string{"test-key": string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}))})
	transport := transportFunc(func(r *http.Request) (*http.Response, error) {
		body := string(keys)
		if strings.Contains(r.URL.Path, "accounts:lookup") {
			body = `{"users":[{"localId":"test-uid","email":"person@example.com","emailVerified":true,"validSince":"0","disabled":false}]}`
		}
		return &http.Response{StatusCode: 200, Header: http.Header{"Cache-Control": {"public, max-age=3600"}, "Content-Type": {"application/json"}}, Body: io.NopCloser(strings.NewReader(body))}, nil
	})
	fixture := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "public, max-age=3600")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(keys)
	}))
	t.Cleanup(fixture.Close)
	local := fixture.Client().Transport.(*http.Transport).Clone()
	local.TLSClientConfig.InsecureSkipVerify = true // Only the local test certificate fixture.
	local.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, network, fixture.Listener.Addr().String())
	}
	previous := http.DefaultTransport
	http.DefaultTransport = local
	t.Cleanup(func() { http.DefaultTransport = previous; local.CloseIdleConnections() })
	app, err := firebase.NewApp(context.Background(), &firebase.Config{ProjectID: "demo-mobile-tracer"}, option.WithHTTPClient(&http.Client{Transport: transport}))
	if err != nil {
		t.Fatal(err)
	}
	client, err := app.Auth(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	sign := func(issuer string, change func(map[string]any, map[string]any)) string {
		header := map[string]any{"alg": "RS256", "kid": "test-key", "typ": "JWT"}
		now := time.Now().Unix()
		claims := map[string]any{"aud": "demo-mobile-tracer", "iss": issuer, "sub": "test-uid", "iat": now, "exp": now + 3600, "auth_time": now, "email": "person@example.com", "email_verified": true}
		if change != nil {
			change(header, claims)
		}
		h, _ := json.Marshal(header)
		b, _ := json.Marshal(claims)
		raw := base64.RawURLEncoding.EncodeToString(h) + "." + base64.RawURLEncoding.EncodeToString(b)
		sum := sha256.Sum256([]byte(raw))
		sig, e := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, sum[:])
		if e != nil {
			t.Fatal(e)
		}
		return raw + "." + base64.RawURLEncoding.EncodeToString(sig)
	}
	for _, kind := range []string{"ID token", "session cookie"} {
		t.Run(kind, func(t *testing.T) {
			issuer := "https://securetoken.google.com/demo-mobile-tracer"
			verify := client.VerifyIDTokenAndCheckRevoked
			if kind == "session cookie" {
				issuer = "https://session.firebase.google.com/demo-mobile-tracer"
				verify = client.VerifySessionCookieAndCheckRevoked
			}
			if _, err := verify(t.Context(), sign(issuer, nil)); err != nil {
				t.Fatal(err)
			}
			for _, invalid := range []string{"signature", "expired", "issuer", "audience", "algorithm", "unsigned"} {
				t.Run(invalid, func(t *testing.T) {
					token := sign(issuer, func(h, c map[string]any) {
						switch invalid {
						case "expired":
							c["exp"] = time.Now().Add(-time.Hour).Unix()
						case "issuer":
							c["iss"] = "https://evil.example"
						case "audience":
							c["aud"] = "other-project"
						case "algorithm":
							h["alg"] = "HS256"
						case "unsigned":
							h["alg"] = "none"
						}
					})
					if invalid == "signature" {
						parts := strings.Split(token, ".")
						parts[2] = base64.RawURLEncoding.EncodeToString(make([]byte, 256))
						token = strings.Join(parts, ".")
					}
					if _, err := verify(t.Context(), token); err == nil {
						t.Fatal("invalid credential accepted")
					}
				})
			}
		})
	}
}
