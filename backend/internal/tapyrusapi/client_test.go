package tapyrusapi

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"errors"
	"math/big"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/nao317/mobile_tracer/backend/internal/config"
)

func apiTestClient(t *testing.T, handler http.Handler) (*Client, *httptest.Server) {
	t.Helper()
	key, e := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if e != nil {
		t.Fatal(e)
	}
	template := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "test client"}, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour), IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth}}
	der, e := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if e != nil {
		t.Fatal(e)
	}
	private, e := x509.MarshalECPrivateKey(key)
	if e != nil {
		t.Fatal(e)
	}
	pool := x509.NewCertPool()
	pool.AppendCertsFromPEM(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}))
	server := httptest.NewUnstartedServer(handler)
	server.TLS = &tls.Config{ClientAuth: tls.RequireAndVerifyClientCert, ClientCAs: pool, MinVersion: tls.VersionTLS12}
	server.StartTLS()
	t.Cleanup(server.Close)
	dir := t.TempDir()
	certFile, keyFile, tokenFile, caFile := filepath.Join(dir, "client.crt"), filepath.Join(dir, "client.key"), filepath.Join(dir, "token"), filepath.Join(dir, "ca.crt")
	for file, data := range map[string][]byte{certFile: pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), keyFile: pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: private}), tokenFile: []byte("test-token"), caFile: pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: server.Certificate().Raw})} {
		if e = os.WriteFile(file, data, 0600); e != nil {
			t.Fatal(e)
		}
	}
	client, e := New(config.TapyrusAPI{URL: server.URL, TokenFile: tokenFile, CertFile: certFile, KeyFile: keyFile, CAFile: caFile, Timeout: time.Second})
	if e != nil {
		t.Fatal(e)
	}
	return client, server
}
func validTimestamp(hash string) Timestamp {
	return Timestamp{ID: 1, Version: "2", Txid: strings.Repeat("a", 64), Status: "unconfirmed", ContentHash: hash, Prefix: Prefix, Type: "simple"}
}
func TestTimestampAPIProtocol(t *testing.T) {
	hash := strings.Repeat("b", 64)
	posts := 0
	client, _ := apiTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-token" || r.TLS == nil || len(r.TLS.PeerCertificates) == 0 {
			t.Error("missing authentication")
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.Method + " " + r.URL.Path {
		case "POST /api/v2/timestamps":
			posts++
			var body map[string]string
			if json.NewDecoder(r.Body).Decode(&body) != nil || body["content"] != hash || body["digest"] != "none" || body["type"] != "simple" || body["prefix"] != Prefix {
				t.Error("wrong timestamp payload")
			}
			w.WriteHeader(201)
			json.NewEncoder(w).Encode(validTimestamp(hash))
		case "GET /api/v2/timestamps/1":
			json.NewEncoder(w).Encode(validTimestamp(hash))
		case "GET /api/v2/timestamps":
			json.NewEncoder(w).Encode(map[string]any{"count": 1, "timestamps": []Timestamp{validTimestamp(hash)}})
		default:
			http.NotFound(w, r)
		}
	}))
	if _, e := client.Create(t.Context(), hash); e != nil {
		t.Fatal(e)
	}
	if _, e := client.Get(t.Context(), 1); e != nil {
		t.Fatal(e)
	}
	if _, e := client.Find(t.Context(), hash); e != nil {
		t.Fatal(e)
	}
	if posts != 1 {
		t.Fatal("unexpected repost")
	}
}
func TestTimestampLostResponseIsNotResent(t *testing.T) {
	hash := strings.Repeat("c", 64)
	posts := 0
	client, _ := apiTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "POST" {
			posts++
			conn, _, _ := w.(http.Hijacker).Hijack()
			conn.Close()
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"count": 1, "timestamps": []Timestamp{validTimestamp(hash)}})
	}))
	if _, e := client.Create(t.Context(), hash); !errors.Is(e, ErrUncertain) {
		t.Fatalf("expected uncertain response: %v", e)
	}
	if found, e := client.Find(t.Context(), hash); e != nil || found == nil {
		t.Fatal("could not recover", e)
	}
	if posts != 1 {
		t.Fatal("duplicate POST")
	}
}
func TestTimestampAPIRejectAndMismatch(t *testing.T) {
	hash := strings.Repeat("d", 64)
	client, _ := apiTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(400)
		w.Write([]byte(`{"error":"secret-provider-details"}`))
	}))
	_, e := client.Create(t.Context(), hash)
	var rejected *RejectedError
	if !errors.As(e, &rejected) || strings.Contains(e.Error(), "secret") {
		t.Fatal("wrong rejection", e)
	}
	if e = Validate(validTimestamp(strings.Repeat("e", 64)), hash); !errors.Is(e, ErrMismatch) {
		t.Fatal("mismatched content accepted")
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if _, e = client.Get(ctx, 1); !errors.Is(e, ErrUncertain) {
		t.Fatal("cancellation accepted")
	}
}
func TestTimestampInitStatus(t *testing.T) {
	hash := strings.Repeat("a", 64)
	accepted := validTimestamp(hash)
	accepted.Status = "init"
	if e := Validate(accepted, hash); e != nil {
		t.Fatal("init response rejected", e)
	}
	accepted.Txid = ""
	if e := Validate(accepted, hash); !errors.Is(e, ErrUncertain) {
		t.Fatal("init response without txid accepted", e)
	}
	unknown := validTimestamp(hash)
	unknown.Status = "pending"
	if e := Validate(unknown, hash); !errors.Is(e, ErrUncertain) {
		t.Fatal("unknown status accepted", e)
	}
}
func TestTimestampNoCredentialRedirect(t *testing.T) {
	redirected := false
	client, _ := apiTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/unexpected" {
			redirected = true
		}
		http.Redirect(w, r, "/unexpected", http.StatusFound)
	}))
	if _, e := client.Create(t.Context(), strings.Repeat("f", 64)); !errors.Is(e, ErrUncertain) {
		t.Fatal("redirect not rejected", e)
	}
	if redirected {
		t.Fatal("authenticated request followed redirect")
	}
}
