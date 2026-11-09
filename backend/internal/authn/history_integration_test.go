package authn_test

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/nao317/mobile_tracer/backend/internal/authn"
)

func TestTransactionHistoryPostgres(t *testing.T) {
	h := newRig(t)
	staff := h.login(101)
	record := workflowRecord(h, staff)
	workflowPhoto(h, staff, record.Draft.ID, uid(80120))
	staffHistory := h.call("GET", "/api/me/history", "", staff, nil)
	h.expect(staffHistory, 200)
	if !strings.Contains(staffHistory.Body.String(), record.Draft.ID) || !strings.Contains(staffHistory.Body.String(), `"count":2`) {
		t.Fatal("record creation and upload must be grouped", staffHistory.Body.String())
	}
	own, user := managementLogin(h, "history-owner", "history@example.com")
	other, _ := managementLogin(h, "history-other", "other@example.com")
	h.expect(h.call("GET", "/api/me/history", "", nil, nil), 401)
	for i := 0; i < 21; i++ {
		err := h.db.Exec(`INSERT INTO audit.events(actor_type,actor_id,action,target_type,target_id,result,entry_hash) VALUES('user',?,'transaction.photo','record_version',?,'succeeded','test')`, user.ID, uid(80000+i)).Error
		if err != nil {
			t.Fatal(err)
		}
	}
	for i := 0; i < 2; i++ {
		if err := h.db.Exec(`INSERT INTO audit.events(actor_type,actor_id,action,target_type,target_id,result,entry_hash) VALUES('user',?,'transaction.respond','record_version',?,'succeeded','test')`, user.ID, uid(80000)).Error; err != nil {
			t.Fatal(err)
		}
	}
	var page struct {
		Data []struct {
			TargetID string `json:"target_id"`
			Count    int    `json:"count"`
		}
		Pagination struct {
			Total int `json:"total"`
		}
	}
	w := h.call("GET", "/api/me/history", "", own, nil)
	h.expect(w, 200)
	if err := json.Unmarshal(w.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	if len(page.Data) != 20 || page.Pagination.Total != 21 {
		t.Fatal(w.Body.String())
	}
	found := false
	for _, item := range page.Data {
		if item.TargetID == uid(80000) {
			found = true
			if item.Count != 3 {
				t.Fatal(item)
			}
		}
	}
	if !found {
		t.Fatal("recent transaction absent")
	}
	w = h.call("GET", "/api/me/history?page=2", "", own, nil)
	h.expect(w, 200)
	if err := json.Unmarshal(w.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	if len(page.Data) != 1 {
		t.Fatal(w.Body.String())
	}
	w = h.call("GET", "/api/me/history", "", other, nil)
	h.expect(w, 200)
	if strings.Contains(w.Body.String(), uid(80000)) {
		t.Fatal("another user's transaction leaked")
	}
	h.expect(h.call("GET", "/api/me/history?page=0", "", own, nil), 400)

	admin, _ := managementLogin(h, "history-admin", "admin@example.com")
	body := managementRequest(t, uid(80100), "business_upgrade", nil, map[string]any{"display_name": "履歴利用者", "reason": "業務利用"})
	w = h.call("POST", "/api/me/requests", body, own, nil)
	h.expect(w, 201)
	request := managementData[authn.ManagementRequest](t, w)
	h.expect(h.call("POST", fmt.Sprintf("/api/admin/requests/%s/decision", request.ID), `{"decision":"approved","reason":"確認済み"}`, admin, nil), 200)
	w = h.call("GET", "/api/me/history", "", own, nil)
	h.expect(w, 200)
	if !strings.Contains(w.Body.String(), "management.request_approved") || !strings.Contains(w.Body.String(), `"own_application":true`) {
		t.Fatal(w.Body.String())
	}
	w = h.call("GET", "/api/me/history", "", other, nil)
	h.expect(w, 200)
	if strings.Contains(w.Body.String(), request.ID) {
		t.Fatal("application leaked")
	}
}
