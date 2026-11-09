package authn_test

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"
)

type workflowChainMock struct {
	mu        sync.Mutex
	raw       []string
	prepares  int
	confirmed bool
}

func (m *workflowChainMock) Prepare(context.Context, string) (string, string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.prepares++
	return "signed-transaction", strings.Repeat("a", 64), nil
}
func (m *workflowChainMock) Broadcast(_ context.Context, raw string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.raw = append(m.raw, raw)
	return errors.New("response lost")
}
func (m *workflowChainMock) Anchored(context.Context, string, string) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.confirmed, nil
}
func TestWorkflowQueueRecoveryPostgres(t *testing.T) {
	h := newRig(t)
	staff := h.login(101)
	customer, user := managementLogin(h, "queue-customer", "queue@example.com")
	r := workflowRecord(h, staff)
	id := r.Draft.ID
	path := "/api/transactions/" + id
	workflowPhoto(h, staff, id, uid(940))
	body := managementJSON(t, map[string]any{"request_key": uid(941), "lock_version": 0, "recipients": []map[string]string{{"email": user.Email, "qualification": "owner", "kind": "state_agreement", "statement": "承認対象", "deadline": time.Now().Add(time.Hour).UTC().Format(time.RFC3339)}}})
	h.expect(h.call("POST", path+"/present", body, staff, nil), 200)
	var q struct{ ID string }
	h.db.Table("app.workflow_requests").Where("version_id=?", id).Take(&q)
	h.expect(h.call("POST", path+"/respond", managementJSON(t, map[string]string{"request_id": q.ID, "decision": "approved"}), customer, nil), 200)
	mock := &workflowChainMock{}
	// Install the chain with a canceled worker context; run deterministic queue turns below.
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	h.service.StartWorkflow(ctx, mock)
	h.exec("UPDATE app.workflow_anchors SET updated_at=now()-interval '1 minute' WHERE version_id=?", id)
	if err := h.service.ProcessWorkflowQueue(t.Context()); err != nil {
		t.Fatal(err)
	}
	h.exec("UPDATE app.workflow_anchors SET updated_at=now()-interval '1 minute' WHERE version_id=?", id)
	if err := h.service.ProcessWorkflowQueue(t.Context()); err != nil {
		t.Fatal(err)
	}
	mock.mu.Lock()
	if mock.prepares != 1 || len(mock.raw) != 2 || mock.raw[0] != mock.raw[1] {
		t.Fatal("retry created another transaction")
	}
	mock.confirmed = true
	mock.mu.Unlock()
	h.exec("UPDATE app.workflow_anchors SET updated_at=now()-interval '1 minute' WHERE version_id=?", id)
	if err := h.service.ProcessWorkflowQueue(t.Context()); err != nil {
		t.Fatal(err)
	}
	if managementCount(h, "app.workflow_anchors", "version_id=? AND status='registered'", id) != 1 {
		t.Fatal("confirmed anchor not recorded")
	}
	w := h.call("POST", path+"/verify", "{}", customer, nil)
	h.expect(w, 200)
	if !strings.Contains(w.Body.String(), `"match"`) {
		t.Fatal(w.Body.String())
	}

	receiver, recipient := managementLogin(h, "history-receiver", "receiver@example.com")
	shareBody := managementJSON(t, map[string]string{"email": recipient.Email, "expires_at": time.Now().Add(time.Hour).UTC().Format(time.RFC3339)})
	h.expect(h.call("POST", path+"/share", shareBody, customer, nil), 201)
	var share struct{ ID string }
	h.db.Table("app.workflow_shares").Where("version_id=?", id).Take(&share)
	w = h.call("GET", "/api/transactions/shares", "", receiver, nil)
	h.expect(w, 200)
	if !strings.Contains(w.Body.String(), `"content":null`) {
		t.Fatal("shared contents visible before acceptance")
	}
	h.expect(h.call("POST", "/api/transactions/shares/"+share.ID+"/accept", "{}", customer, nil), 403)
	h.expect(h.call("POST", "/api/transactions/shares/"+share.ID+"/accept", "{}", receiver, nil), 200)
	w = h.call("GET", "/api/transactions/shares", "", receiver, nil)
	h.expect(w, 200)
	if strings.Contains(w.Body.String(), "notes") || strings.Contains(w.Body.String(), "点検結果") || !strings.Contains(w.Body.String(), "odometer") {
		t.Fatal("incorrect shared scope", w.Body.String())
	}
	h.expect(h.call("GET", path, "", receiver, nil), 404)
	h.expect(h.call("POST", "/api/transactions/shares/"+share.ID+"/revoke", "{}", customer, nil), 200)
	w = h.call("GET", "/api/transactions/shares", "", receiver, nil)
	h.expect(w, 200)
	if !strings.Contains(w.Body.String(), `"content":null`) {
		t.Fatal("revoked content visible")
	}
	h.exec("ALTER TABLE app.workflow_media DISABLE TRIGGER workflow_media_fixed")
	h.exec("ALTER TABLE app.workflow_media DISABLE TRIGGER workflow_media_draft")
	h.exec("UPDATE app.workflow_media SET bytes=? WHERE record_version_id=?", []byte("tampered"), id)
	w = h.call("POST", path+"/verify", "{}", customer, nil)
	h.expect(w, 200)
	if !strings.Contains(w.Body.String(), `"mismatch"`) {
		t.Fatal(w.Body.String())
	}
	h.exec("DELETE FROM app.workflow_media WHERE record_version_id=?", id)
	w = h.call("POST", path+"/verify", "{}", customer, nil)
	h.expect(w, 200)
	if !strings.Contains(w.Body.String(), `"unverifiable"`) {
		t.Fatal(w.Body.String())
	}
}
