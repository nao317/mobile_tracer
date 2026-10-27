package business_test

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/labstack/echo/v5"
	"github.com/nao317/mobile_tracer/backend/db/seeds"
	"github.com/nao317/mobile_tracer/backend/internal/business"
	"github.com/nao317/mobile_tracer/backend/internal/config"
	"github.com/nao317/mobile_tracer/backend/internal/database"
	"github.com/nao317/mobile_tracer/backend/internal/server"
	"gorm.io/gorm"
)

const token = "development-test-token-with-at-least-32-bytes"

func uid(n int) string { return fmt.Sprintf("00000000-0000-0000-0000-%012d", n) }

func testDB(t *testing.T) *gorm.DB {
	t.Helper()
	if os.Getenv("TEST_DATABASE") != "1" {
		t.Skip("set TEST_DATABASE=1 and POSTGRES_* for isolated PostgreSQL integration tests")
	}
	cfg, err := config.LoadDatabase()
	if err != nil {
		t.Fatal(err)
	}
	admin, err := database.Open(t.Context(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = admin.Close() })
	var suffix [8]byte
	if _, err := rand.Read(suffix[:]); err != nil {
		t.Fatal(err)
	}
	name := "crud_test_" + hex.EncodeToString(suffix[:])
	if err := admin.GORM.Exec(`CREATE DATABASE "` + name + `"`).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := admin.GORM.Exec(`DROP DATABASE "` + name + `" WITH (FORCE)`).Error; err != nil {
			t.Error(err)
		}
	})
	cfg.Name = name
	db, err := database.Open(t.Context(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	migration, err := os.ReadFile("../../db/migrations/000001_init.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	if err := db.GORM.Transaction(func(tx *gorm.DB) error { return tx.Exec(string(migration)).Error }); err != nil {
		t.Fatal(err)
	}
	if err := seeds.Apply(t.Context(), db.GORM); err != nil {
		t.Fatal(err)
	}
	if err := seeds.Apply(t.Context(), db.GORM); err != nil {
		t.Fatalf("seed is not repeatable: %v", err)
	}
	return db.GORM
}

func app(db *gorm.DB, staff int) *echo.Echo {
	e := server.New(slog.New(slog.NewJSONHandler(io.Discard, nil)))
	server.RegisterBusiness(e, business.New(db), config.BusinessAuth{Environment: "development", Token: token, StaffID: uid(staff)})
	return e
}

func call(e http.Handler, method, path, body, credential string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if credential != "" {
		req.Header.Set("Authorization", "Bearer "+credential)
	}
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec
}

func request(t *testing.T, e http.Handler, method, path, body string, status int) json.RawMessage {
	t.Helper()
	rec := call(e, method, path, body, token)
	if rec.Code != status {
		t.Fatalf("%s %s: got %d, want %d: %s", method, path, rec.Code, status, rec.Body.String())
	}
	if !strings.HasPrefix(rec.Header().Get("Content-Type"), "application/json") {
		t.Fatalf("not JSON: %s", rec.Body.String())
	}
	return rec.Body.Bytes()
}

func data[T any](t *testing.T, raw []byte) T {
	t.Helper()
	var result struct {
		Data T `json:"data"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		t.Fatal(err)
	}
	return result.Data
}

func newCase(t *testing.T, e http.Handler, vehicle string) business.Case {
	t.Helper()
	return data[business.Case](t, request(t, e, "POST", "/api/cases", fmt.Sprintf(`{"store_id":%q,"vehicle_id":%q,"case_type":"rental","configuration_version_id":%q}`, uid(11), vehicle, uid(1001)), 201))
}

func newRecord(t *testing.T, e http.Handler, caseID string) business.RecordCreated {
	t.Helper()
	return data[business.RecordCreated](t, request(t, e, "POST", "/api/cases/"+caseID+"/records", `{"record_kind":"inspection","entries":{"odometer":10}}`, 201))
}

func versionPath(c string, record business.RecordCreated) string {
	return "/api/cases/" + c + "/records/" + record.Record.ID + "/versions/" + record.Draft.ID
}

func TestBusinessPostgres(t *testing.T) {
	db := testDB(t)
	admin, manager, staff, auditor := app(db, 101), app(db, 102), app(db, 103), app(db, 104)
	exec := func(sql string, args ...any) {
		t.Helper()
		if err := db.Exec(sql, args...).Error; err != nil {
			t.Fatal(err)
		}
	}
	count := func(table string) int64 {
		t.Helper()
		var n int64
		if err := db.Table(table).Count(&n).Error; err != nil {
			t.Fatal(err)
		}
		return n
	}

	t.Run("authentication and context", func(t *testing.T) {
		for _, credential := range []string{"", "wrong-token"} {
			if got := call(admin, "GET", "/api/context", "", credential); got.Code != 401 || got.Header().Get("WWW-Authenticate") != "Bearer" {
				t.Fatalf("unexpected auth response: %d %s", got.Code, got.Body.String())
			}
		}
		ctx := data[business.Context](t, request(t, manager, "GET", "/api/context", "", 200))
		if ctx.Principal.StaffID != uid(102) || len(ctx.Stores) != 1 || ctx.Stores[0].ID != uid(11) || ctx.Configuration == nil {
			t.Fatalf("incorrect scoped context: %+v", ctx)
		}
		e := server.New(slog.New(slog.NewJSONHandler(io.Discard, nil)))
		server.RegisterBusiness(e, business.New(db), config.BusinessAuth{Environment: "production", Token: token, StaffID: uid(101)})
		request(t, e, "GET", "/api/context", "", 401)
		request(t, e, "GET", "/api/health", "", 200)
		for _, path := range []string{"/api", "/api/not-a-real-endpoint"} {
			raw := request(t, e, "GET", path, "", 404)
			var result struct {
				Error business.Error `json:"error"`
			}
			if err := json.Unmarshal(raw, &result); err != nil || result.Error.Code != "not_found" {
				t.Fatalf("invalid API routing error: %s", raw)
			}
		}
	})

	t.Run("tenant store and case scopes", func(t *testing.T) {
		request(t, admin, "GET", "/api/cases/"+uid(6001), "", 404)
		request(t, manager, "GET", "/api/cases/"+uid(5002), "", 404)
		request(t, manager, "GET", "/api/vehicles/"+uid(3002), "", 404)
		request(t, staff, "GET", "/api/cases/"+uid(5001), "", 200)
		request(t, staff, "GET", "/api/cases/"+uid(5002), "", 404)
		request(t, auditor, "POST", "/api/cases/"+uid(5001)+"/records", `{"record_kind":"inspection"}`, 403)
		request(t, manager, "POST", "/api/vehicles", `{"model_name":"禁止"}`, 403)
		for _, actor := range []*echo.Echo{manager, staff} {
			var result business.Page[business.Case]
			if err := json.Unmarshal(request(t, actor, "GET", "/api/cases", "", 200), &result); err != nil {
				t.Fatal(err)
			}
			if len(result.Data) != 1 || result.Data[0].ID != uid(5001) {
				t.Fatalf("scope leaked: %+v", result)
			}
			var vehicles business.Page[business.Vehicle]
			if err := json.Unmarshal(request(t, actor, "GET", "/api/vehicles", "", 200), &vehicles); err != nil {
				t.Fatal(err)
			}
			if len(vehicles.Data) != 1 || vehicles.Data[0].ID != uid(3001) {
				t.Fatalf("vehicle scope leaked: %+v", vehicles)
			}
		}
		request(t, admin, "POST", "/api/cases", fmt.Sprintf(`{"store_id":%q,"vehicle_id":%q,"case_type":"rental","configuration_version_id":%q}`, uid(11), uid(4001), uid(1001)), 404)
		request(t, manager, "POST", "/api/cases", fmt.Sprintf(`{"store_id":%q,"vehicle_id":%q,"case_type":"rental","configuration_version_id":%q}`, uid(12), uid(3001), uid(1001)), 403)
		request(t, admin, "POST", "/api/cases", fmt.Sprintf(`{"store_id":%q,"vehicle_id":%q,"case_type":"rental","configuration_version_id":%q}`, uid(11), uid(3001), uid(2001)), 400)
	})

	t.Run("create retrieve edit search and paginate", func(t *testing.T) {
		vehicle := data[business.Vehicle](t, request(t, admin, "POST", "/api/vehicles", `{"model_name":"CRUD sample","identifiers":[{"kind":"plate_number","value":"TEST-CRUD"}]}`, 201))
		if !business.ValidID(vehicle.ID) || len(vehicle.Identifiers) != 1 || vehicle.CreatedAt.IsZero() {
			t.Fatalf("invalid created vehicle: %+v", vehicle)
		}
		request(t, admin, "PATCH", "/api/vehicles/"+vehicle.ID, `{"model_name":"CRUD updated"}`, 200)
		var list business.Page[business.Vehicle]
		if err := json.Unmarshal(request(t, admin, "GET", "/api/vehicles?q=TEST-CRUD&page_size=1&sort=model_name", "", 200), &list); err != nil {
			t.Fatal(err)
		}
		if len(list.Data) != 1 || list.Data[0].ID != vehicle.ID || list.Pagination.Total != 1 {
			t.Fatalf("incorrect vehicle search: %+v", list)
		}
		if err := json.Unmarshal(request(t, admin, "GET", "/api/vehicles?q=TEST-CRUD&page_size=1&page=2", "", 200), &list); err != nil {
			t.Fatal(err)
		}
		if len(list.Data) != 0 || list.Pagination.Total != 1 {
			t.Fatalf("incorrect second page: %+v", list)
		}
		v := data[business.Vehicle](t, request(t, admin, "PATCH", "/api/vehicles/"+vehicle.ID, `{"model_name":null}`, 200))
		if v.ModelName != nil {
			t.Fatal("explicit null was not applied")
		}
		c := newCase(t, admin, vehicle.ID)
		if c.Stage != "intake" || c.Status != "in_progress" {
			t.Fatalf("incorrect initial case state: %+v", c)
		}
		request(t, staff, "GET", "/api/cases/"+c.ID, "", 404)
		request(t, manager, "GET", "/api/cases/"+c.ID, "", 200)
		request(t, admin, "PATCH", "/api/cases/"+c.ID, fmt.Sprintf(`{"assignee_id":%q,"stage":"inspection"}`, uid(103)), 200)
		request(t, staff, "GET", "/api/cases/"+c.ID, "", 200)
		request(t, staff, "PATCH", "/api/cases/"+c.ID, `{"assignee_id":null}`, 403)
		request(t, admin, "PATCH", "/api/cases/"+c.ID, `{"stage":"intake"}`, 409)
		request(t, admin, "PATCH", "/api/cases/"+c.ID, fmt.Sprintf(`{"assignee_id":%q}`, uid(201)), 400)
		record := newRecord(t, staff, c.ID)
		if record.Draft.LockVersion != 0 || record.Draft.VersionNo != 1 || string(record.Draft.Entries["odometer"]) != "10" {
			t.Fatalf("incorrect created draft: %+v", record)
		}
		path := versionPath(c.ID, record)
		request(t, staff, "GET", "/api/cases/"+c.ID+"/records/"+record.Record.ID, "", 200)
		request(t, staff, "GET", "/api/cases/"+c.ID+"/records?record_kind=inspection&page_size=1", "", 200)
		request(t, staff, "GET", "/api/cases/"+c.ID+"/records/"+record.Record.ID+"/versions?status=draft&sort=version_no", "", 200)
		updated := data[business.Version](t, request(t, staff, "PUT", path+"/entries", `{"lock_version":0,"entries":{"odometer":11,"notes":"確認済み","inspected":true}}`, 200))
		if updated.LockVersion != 1 || string(updated.Entries["odometer"]) != "11" {
			t.Fatalf("draft was not updated: %+v", updated)
		}
		request(t, staff, "PUT", path+"/entries", `{"lock_version":0,"entries":{"odometer":999}}`, 409)
		got := data[business.Version](t, request(t, staff, "GET", path, "", 200))
		if got.LockVersion != 1 || string(got.Entries["odometer"]) != "11" {
			t.Fatal("stale write changed draft")
		}
		request(t, staff, "GET", strings.Replace(path, c.ID, uid(5001), 1), "", 404)
		request(t, staff, "DELETE", path, "", 405)
		request(t, admin, "DELETE", "/api/vehicles/"+vehicle.ID, "", 405)
		var caseList business.Page[business.Case]
		if err := json.Unmarshal(request(t, admin, "GET", "/api/cases?vehicle_id="+vehicle.ID+"&stage=inspection&status=in_progress&page_size=1", "", 200), &caseList); err != nil {
			t.Fatal(err)
		}
		if caseList.Pagination.Total != 1 || len(caseList.Data) != 1 {
			t.Fatalf("incorrect case filters: %+v", caseList)
		}
		request(t, admin, "POST", "/api/cases/"+c.ID+"/cancel", `{"reason":"開発用キャンセル"}`, 200)
		request(t, admin, "PATCH", "/api/cases/"+c.ID, `{"assignee_id":null}`, 409)
		request(t, admin, "POST", "/api/cases/"+c.ID+"/records", `{"record_kind":"inspection"}`, 409)
		request(t, admin, "PUT", path+"/entries", `{"lock_version":1,"entries":{}}`, 409)
		request(t, admin, "GET", path, "", 200)
		if count("audit.events") < 7 {
			t.Fatal("successful writes were not audited")
		}
	})

	t.Run("strict bodies and invalid inputs", func(t *testing.T) {
		for _, path := range []string{"/api/vehicles?page=0", "/api/vehicles?page_size=101", "/api/vehicles?sort=model_name;DROP", "/api/vehicles?tenant_id=" + uid(2), "/api/cases?status=wrong", "/api/cases?store_id=oops", "/api/vehicles?q=", "/api/vehicles?page=1&page=2", "/api/cases?page=999999999999999999999", "/api/vehicles/not-a-uuid"} {
			request(t, admin, "GET", path, "", 400)
		}
		for _, body := range []string{`null`, `[]`, `{} {}`, `{"model_name":1}`, `{"tenant_id":"fake"}`, `{"model_name":" "}`} {
			request(t, admin, "POST", "/api/vehicles", body, 400)
		}
		req := httptest.NewRequest("POST", "/api/vehicles", strings.NewReader(`{}`))
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		admin.ServeHTTP(rec, req)
		if rec.Code != 415 {
			t.Fatal("missing JSON content type accepted")
		}
		request(t, admin, "POST", "/api/vehicles", `{"model_name":"`+strings.Repeat("a", 1<<20)+`"}`, 413)
		request(t, admin, "PATCH", "/api/vehicles/"+uid(3001), `{}`, 400)
		request(t, admin, "PATCH", "/api/cases/"+uid(5001), `{"status":"completed"}`, 400)
		n := count("app.records")
		for _, body := range []string{`{"record_kind":"unknown"}`, `{"record_kind":"inspection","entries":{"unknown":1}}`, `{"record_kind":"inspection","entries":{"odometer":-1}}`, `{"record_kind":"inspection","entries":{"odometer":"10"}}`} {
			request(t, admin, "POST", "/api/cases/"+uid(5001)+"/records", body, 400)
		}
		if count("app.records") != n {
			t.Fatal("invalid create left a record")
		}
	})

	t.Run("simultaneous draft updates", func(t *testing.T) {
		record := newRecord(t, admin, uid(5001))
		path := versionPath(uid(5001), record)
		start := make(chan struct{})
		statuses := make(chan int, 2)
		for i := 0; i < 2; i++ {
			go func(n int) {
				<-start
				rec := call(admin, "PUT", path+"/entries", fmt.Sprintf(`{"lock_version":0,"entries":{"odometer":%d}}`, n), token)
				statuses <- rec.Code
			}(i + 100)
		}
		close(start)
		a, b := <-statuses, <-statuses
		if !((a == 200 && b == 409) || (a == 409 && b == 200)) {
			t.Fatalf("concurrent results: %d, %d", a, b)
		}
		v := data[business.Version](t, request(t, admin, "GET", path, "", 200))
		if v.LockVersion != 1 {
			t.Fatalf("version incremented incorrectly: %d", v.LockVersion)
		}
	})

	t.Run("submitted versions remain immutable", func(t *testing.T) {
		record := newRecord(t, admin, uid(5001))
		path := versionPath(uid(5001), record)
		exec("UPDATE app.record_versions SET status='submitted',vehicle_snapshot='{}',hash_algorithm='sha256',content_hash=repeat('a',64),submit_idempotency_key=gen_random_uuid(),submitted_by=?,submitted_at=now() WHERE id=?", uid(101), record.Draft.ID)
		request(t, admin, "GET", path, "", 200)
		request(t, admin, "PUT", path+"/entries", `{"lock_version":0,"entries":{"odometer":20}}`, 409)
		if err := db.Exec("UPDATE app.record_entries SET value='20' WHERE record_version_id=?", record.Draft.ID).Error; err == nil {
			t.Fatal("DB trigger allowed submitted entry update")
		}
	})

	t.Run("audit failure rolls back all writes", func(t *testing.T) {
		record := newRecord(t, admin, uid(5001))
		path := versionPath(uid(5001), record)
		exec(`CREATE FUNCTION app.crud_test_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION USING ERRCODE='XX000', MESSAGE='private SQL database detail'; END $$`)
		exec(`CREATE TRIGGER crud_test_fail_audit BEFORE INSERT ON audit.events FOR EACH ROW EXECUTE FUNCTION app.crud_test_fail_audit()`)
		defer exec(`DROP TRIGGER crud_test_fail_audit ON audit.events`)
		nr, nv, ne, na := count("app.records"), count("app.record_versions"), count("app.record_entries"), count("audit.events")
		body := request(t, admin, "POST", "/api/cases/"+uid(5001)+"/records", `{"record_kind":"inspection","entries":{"odometer":123}}`, 500)
		if bytes.Contains(body, []byte("private")) || bytes.Contains(body, []byte("SQL")) {
			t.Fatal("internal DB error leaked")
		}
		if nr != count("app.records") || nv != count("app.record_versions") || ne != count("app.record_entries") || na != count("audit.events") {
			t.Fatal("failed create did not roll back")
		}
		request(t, admin, "PUT", path+"/entries", `{"lock_version":0,"entries":{"odometer":555}}`, 500)
		v := data[business.Version](t, request(t, admin, "GET", path, "", 200))
		if v.LockVersion != 0 || string(v.Entries["odometer"]) != "10" {
			t.Fatal("failed draft update did not roll back")
		}
	})

	t.Run("revoked roles and suspended principals", func(t *testing.T) {
		exec("UPDATE app.staff_members SET status='suspended' WHERE id=?", uid(103))
		request(t, staff, "GET", "/api/cases/"+uid(5001), "", 403)
		exec("UPDATE app.staff_role_assignments SET revoked_by=?,revoked_at=now() WHERE staff_id=?", uid(101), uid(105))
		request(t, app(db, 105), "GET", "/api/context", "", 403)
		exec("UPDATE app.tenants SET status='suspended' WHERE id=?", uid(2))
		request(t, app(db, 201), "GET", "/api/context", "", 403)
	})
}
