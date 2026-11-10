package authn_test

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/nao317/mobile_tracer/backend/internal/authn"
	"github.com/nao317/mobile_tracer/backend/internal/business"
	"github.com/nao317/mobile_tracer/backend/internal/config"
	"github.com/nao317/mobile_tracer/backend/internal/server"
)

func workflowRecord(h *rig, j jar) business.RecordCreated {
	h.t.Helper()
	w := h.call("POST", "/api/cases/"+uid(5001)+"/records", `{"record_kind":"inspection","entries":{"odometer":1234,"notes":"点検結果"}}`, j, nil)
	h.expect(w, 201)
	return managementData[business.RecordCreated](h.t, w)
}
func workflowPhotoRequest(h *rig, j jar, version, key string, context bool) *httptest.ResponseRecorder {
	h.t.Helper()
	var b bytes.Buffer
	writer := multipart.NewWriter(&b)
	f, err := writer.CreateFormFile("photo", "test.png")
	if err != nil {
		h.t.Fatal(err)
	}
	// PNG signature and IHDR; content type must be derived from bytes, not filename.
	_, _ = f.Write([]byte("\x89PNG\r\n\x1a\n" + strings.Repeat("x", 100)))
	_ = writer.WriteField("request_key", key)
	_ = writer.WriteField("position", "正面")
	if context {
		_ = writer.WriteField("device_captured_at", "2026-11-09T10:20:30+09:00")
		_ = writer.WriteField("captured_at_source", "metadata")
		_ = writer.WriteField("latitude", "33.641667")
		_ = writer.WriteField("longitude", "130.687500")
		_ = writer.WriteField("location_label", "九州工業大学 飯塚キャンパス")
		_ = writer.WriteField("location_source", "search")
	}
	_ = writer.Close()
	w := h.call("POST", "/api/transactions/"+version+"/media", "", j, func(r *http.Request) {
		r.Body = io.NopCloser(bytes.NewReader(b.Bytes()))
		r.ContentLength = int64(b.Len())
		r.Header.Set("Content-Type", writer.FormDataContentType())
	})
	return w
}
func workflowPhoto(h *rig, j jar, version, key string) string {
	h.t.Helper()
	w := workflowPhotoRequest(h, j, version, key, true)
	h.expect(w, 201)
	return managementData[struct {
		ID string `json:"id"`
	}](h.t, w).ID
}
func TestCustomerWorkflowPostgres(t *testing.T) {
	h := newRig(t)
	staff := h.login(101)
	customer, user := managementLogin(h, "workflow-customer", "customer@example.com")
	outsider, _ := managementLogin(h, "workflow-outsider", "outside@example.com")
	record := workflowRecord(h, staff)
	id := record.Draft.ID
	path := "/api/transactions/" + id
	h.expect(h.call("GET", path, "", customer, nil), 404)
	h.expect(workflowPhotoRequest(h, staff, id, uid(919), false), 400)
	media := workflowPhoto(h, staff, id, uid(920))
	if got := workflowPhoto(h, staff, id, uid(920)); got != media {
		t.Fatal("duplicate media")
	}
	h.expect(h.call("GET", path+"/media/"+media, "", outsider, nil), 404)
	deadline := time.Now().Add(time.Hour).UTC().Format(time.RFC3339)
	body := managementJSON(t, map[string]any{"request_key": uid(921), "lock_version": 0, "recipients": []map[string]string{{"email": user.Email, "qualification": "owner", "kind": "state_agreement", "statement": "表示された写真と車両状態に同意します", "deadline": deadline}}})
	h.expect(h.call("POST", path+"/present", body, staff, nil), 200)
	h.expect(h.call("POST", path+"/present", body, staff, nil), 200)
	if managementCount(h, "app.workflow_requests", "version_id=?", id) != 1 {
		t.Fatal("duplicate requests")
	}
	h.expect(h.call("GET", path, "", customer, nil), 200)
	h.expect(h.call("GET", path+"/media/"+media, "", customer, nil), 200)
	// Reconstruct the API service: all relationships, original bytes and sessions
	// must come from persistent storage rather than process memory.
	restarted := authn.New(h.db, h.cfg, h.provider, slog.Default())
	api := server.New(slog.Default())
	server.RegisterBusiness(api, business.New(h.db), config.BusinessAuth{Environment: "production"}, restarted)
	restarted.Register(api)
	restarted.RegisterWorkflow(api)
	h.e = api
	h.service = restarted
	h.expect(h.call("GET", path+"/media/"+media, "", customer, nil), 200)

	h.expect(h.call("GET", path, "", outsider, nil), 404)
	list := h.call("GET", "/api/transactions", "", outsider, nil)
	h.expect(list, 200)
	if strings.Contains(list.Body.String(), id) {
		t.Fatal("leaked transaction")
	}
	if managementCount(h, "app.workflow_anchors", "version_id=?", id) != 0 {
		t.Fatal("queued before approval")
	}
	h.expect(h.call("POST", path+"/retry", "{}", staff, nil), 409)
	if managementCount(h, "app.workflow_anchors", "version_id=?", id) != 0 {
		t.Fatal("retry bypassed approval")
	}
	var q struct{ ID string }
	h.db.Table("app.workflow_requests").Where("version_id=?", id).Take(&q)
	answer := managementJSON(t, map[string]string{"request_id": q.ID, "decision": "approved"})
	h.expect(h.call("POST", path+"/respond", answer, staff, nil), 404)
	h.expect(h.call("POST", path+"/respond", answer, customer, func(r *http.Request) { r.Header.Del("X-CSRF-Token") }), 403)
	h.expect(h.call("POST", path+"/respond", answer, customer, nil), 200)
	h.expect(h.call("POST", path+"/respond", answer, customer, nil), 200)
	if managementCount(h, "app.workflow_anchors", "version_id=?", id) != 1 {
		t.Fatal("approval did not queue exactly once")
	}
	h.expect(h.call("POST", path+"/respond", strings.Replace(answer, "approved", "rejected", 1), customer, nil), 409)
	h.expect(h.call("POST", path+"/correct", `{"reason":"状態の追記"}`, staff, nil), 201)
	if managementCount(h, "app.record_versions", "based_on_version_id=? AND status='draft'", id) != 1 {
		t.Fatal("correction missing")
	}
	ownership := managementJSON(t, map[string]string{"user_id": user.ID, "effective_at": time.Now().UTC().Format(time.RFC3339)})
	h.expect(h.call("POST", path+"/ownerships", ownership, customer, nil), 403)
	h.expect(h.call("POST", path+"/ownerships", ownership, staff, nil), 201)
	h.expect(h.call("POST", path+"/verify", "{}", customer, nil), 200)
	var snapshot struct{ Content []byte }
	h.db.Table("app.workflow_presentations").Where("version_id=?", id).Take(&snapshot)
	var content map[string]any
	if err := json.Unmarshal(snapshot.Content, &content); err != nil {
		t.Fatal(err)
	}
}
func TestCustomerWorkflowRefusalPostgres(t *testing.T) {
	for _, decision := range []string{"rejected", "held"} {
		t.Run(decision, func(t *testing.T) {
			h := newRig(t)
			staff := h.login(101)
			customer, user := managementLogin(h, "workflow-"+decision, decision+"@example.com")
			record := workflowRecord(h, staff)
			id := record.Draft.ID
			path := "/api/transactions/" + id
			workflowPhoto(h, staff, id, uid(930))
			body := managementJSON(t, map[string]any{"request_key": uid(931), "lock_version": 0, "recipients": []map[string]string{{"email": user.Email, "qualification": "owner", "kind": "state_agreement", "statement": "状態を確認", "deadline": time.Now().Add(time.Hour).UTC().Format(time.RFC3339)}}})
			h.expect(h.call("POST", path+"/present", body, staff, nil), 200)
			var q struct{ ID string }
			h.db.Table("app.workflow_requests").Where("version_id=?", id).Take(&q)
			h.expect(h.call("POST", path+"/respond", managementJSON(t, map[string]string{"request_id": q.ID, "decision": decision}), customer, nil), 200)
			if managementCount(h, "app.workflow_anchors", "version_id=?", id) != 0 {
				t.Fatal("refused record queued")
			}
		})
	}
}

func TestWorkflowRequiresAllApprovalsPostgres(t *testing.T) {
	h := newRig(t)
	staff := h.login(101)
	customer, user := managementLogin(h, "all-customer", "all@example.com")
	r := workflowRecord(h, staff)
	id := r.Draft.ID
	path := "/api/transactions/" + id
	workflowPhoto(h, staff, id, uid(950))
	recipients := []map[string]string{}
	for _, kind := range []string{"receipt", "state_agreement"} {
		recipients = append(recipients, map[string]string{"email": user.Email, "qualification": "owner", "kind": kind, "statement": "確認事項", "deadline": time.Now().Add(time.Hour).UTC().Format(time.RFC3339)})
	}
	body := managementJSON(t, map[string]any{"request_key": uid(951), "lock_version": 0, "recipients": recipients})
	h.expect(h.call("POST", path+"/present", body, staff, nil), 200)
	if err := h.db.Exec("INSERT INTO app.workflow_anchors(version_id,manifest,manifest_hash) VALUES(?,?,?)", id, []byte("unapproved"), strings.Repeat("a", 64)).Error; err == nil {
		t.Fatal("database accepted anchor before approval")
	}
	qs := []struct{ ID string }{}
	h.db.Table("app.workflow_requests").Where("version_id=?", id).Order("kind").Find(&qs)
	answer := func(id string) {
		h.expect(h.call("POST", path+"/respond", managementJSON(t, map[string]string{"request_id": id, "decision": "approved"}), customer, nil), 200)
	}
	answer(qs[0].ID)
	if managementCount(h, "app.workflow_anchors", "version_id=?", id) != 0 {
		t.Fatal("partial approval queued")
	}
	answer(qs[1].ID)
	if managementCount(h, "app.workflow_anchors", "version_id=?", id) != 1 {
		t.Fatal("all approvals not queued")
	}
}
