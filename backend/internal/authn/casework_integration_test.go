package authn_test

import (
	"fmt"
	"strings"
	"testing"
	"time"
)

type startReceipt struct {
	ID        string `json:"id"`
	CaseID    string `json:"case_id"`
	VersionNo int    `json:"version_no"`
}
type eventReceipt struct {
	ID string `json:"id"`
}

func startCasework(h *rig, staff jar, email string, key int) startReceipt {
	h.t.Helper()
	body := managementJSON(h.t, map[string]any{"store_id": uid(11), "vehicle_id": uid(3001), "case_type": "rental", "configuration_version_id": uid(1001), "assignee_id": uid(103), "email": email, "terms": "貸出条件・車両状態・金額を確認してください", "deadline": time.Now().Add(time.Hour).UTC().Format(time.RFC3339), "request_key": uid(key)})
	w := h.call("POST", "/api/casework/starts", body, staff, nil)
	h.expect(w, 201)
	return managementData[startReceipt](h.t, w)
}
func caseEventBody(h *rig, kind string, key int) map[string]any {
	return map[string]any{"kind": kind, "title": "確認対象", "description": "作業範囲・報告内容", "deadline": time.Now().Add(time.Hour).UTC().Format(time.RFC3339), "request_key": uid(key)}
}
func createEvent(h *rig, j jar, id string, body map[string]any) eventReceipt {
	h.t.Helper()
	w := h.call("POST", "/api/casework/"+id+"/events", managementJSON(h.t, body), j, nil)
	h.expect(w, 201)
	return managementData[eventReceipt](h.t, w)
}
func eventAction(h *rig, j jar, caseID, eventID, action string, key int, detail string, status int) {
	h.t.Helper()
	h.expect(h.call("POST", fmt.Sprintf("/api/casework/%s/events/%s/actions", caseID, eventID), managementJSON(h.t, map[string]any{"action": action, "request_key": uid(key), "detail": detail}), j, nil), status)
}
func TestCaseworkThreeFlowsPostgres(t *testing.T) {
	h := newRig(t)
	staff := h.login(101)
	customer, user := managementLogin(h, "casework-customer", "case-customer@example.com")
	other, _ := managementLogin(h, "casework-other", "other-customer@example.com")
	start := startCasework(h, staff, user.Email, 960)
	base := "/api/casework/" + start.CaseID
	h.expect(h.call("GET", base, "", customer, nil), 200)
	h.expect(h.call("GET", base, "", other, nil), 404)
	h.expect(h.call("POST", "/api/casework/starts/"+start.ID+"/respond", `{"decision":"approved"}`, staff, nil), 404)
	h.expect(h.call("POST", base+"/events", managementJSON(t, caseEventBody(h, "work", 961)), staff, nil), 409)
	h.expect(h.call("POST", "/api/cases/"+start.CaseID+"/records", `{"record_kind":"inspection","entries":{"odometer":10}}`, staff, nil), 409)
	h.expect(h.call("PATCH", "/api/cases/"+start.CaseID, `{"stage":"inspection"}`, staff, nil), 409)
	h.expect(h.call("POST", "/api/casework/starts/"+start.ID+"/respond", `{"decision":"approved"}`, customer, nil), 200)
	h.expect(h.call("POST", "/api/casework/starts/"+start.ID+"/respond", `{"decision":"approved"}`, customer, nil), 200)
	if managementCount(h, "integrity.api_registrations", "subject_type='case_start' AND subject_id=?", start.ID) != 1 {
		t.Fatal("case acceptance not queued exactly once")
	}
	h.expect(h.call("PATCH", "/api/cases/"+start.CaseID, `{"stage":"inspection"}`, staff, nil), 409)
	body := caseEventBody(h, "work", 962)
	body["amount_minor"] = 1000
	body["target_stage"] = "inspection"
	work := createEvent(h, staff, start.CaseID, body)
	eventAction(h, staff, start.CaseID, work.ID, "executed", 963, "", 409)
	eventAction(h, staff, start.CaseID, work.ID, "approved", 964, "", 403)
	eventAction(h, other, start.CaseID, work.ID, "approved", 965, "", 404)
	eventAction(h, customer, start.CaseID, work.ID, "approved", 966, "確認済み", 200)
	eventAction(h, customer, start.CaseID, work.ID, "executed", 967, "", 403)
	eventAction(h, staff, start.CaseID, work.ID, "executed", 968, "", 200)
	eventAction(h, staff, start.CaseID, work.ID, "executed", 968, "", 200)
	eventAction(h, staff, start.CaseID, work.ID, "reported", 969, "作業完了。結果を確認してください", 200)
	eventAction(h, staff, start.CaseID, work.ID, "completed", 970, "", 403)
	eventAction(h, customer, start.CaseID, work.ID, "completed", 971, "確認しました", 200)
	if managementCount(h, "integrity.api_registrations", "subject_type='event_completion' AND subject_id=?", work.ID) != 1 {
		t.Fatal("completion not queued")
	}
	report := createEvent(h, staff, start.CaseID, caseEventBody(h, "progress_report", 972))
	eventAction(h, staff, start.CaseID, report.ID, "executed", 973, "", 409)
	eventAction(h, customer, start.CaseID, report.ID, "approved", 974, "報告を確認", 200)
	incident := createEvent(h, customer, start.CaseID, caseEventBody(h, "incident", 975))
	eventAction(h, customer, start.CaseID, incident.ID, "approved", 976, "", 403)
	eventAction(h, staff, start.CaseID, incident.ID, "approved", 977, "受理します", 200)
	eventAction(h, staff, start.CaseID, incident.ID, "executed", 978, "", 200)
	eventAction(h, staff, start.CaseID, incident.ID, "reported", 979, "対応済み", 200)
	eventAction(h, customer, start.CaseID, incident.ID, "completed", 980, "", 200)
	request := createEvent(h, customer, start.CaseID, caseEventBody(h, "request", 981))
	eventAction(h, staff, start.CaseID, request.ID, "returned", 982, "依頼範囲を追記してください", 200)
	revised := caseEventBody(h, "request", 983)
	revised["supersedes_id"] = request.ID
	createEvent(h, customer, start.CaseID, revised)
	eventAction(h, staff, start.CaseID, request.ID, "approved", 984, "", 409)
	w := h.call("GET", base, "", customer, nil)
	h.expect(w, 200)
	if !strings.Contains(w.Body.String(), `"stage":"inspection"`) || !strings.Contains(w.Body.String(), `"state":"completed"`) {
		t.Fatal(w.Body.String())
	}
}
func TestCaseworkRefusalAndDeadlinePostgres(t *testing.T) {
	for _, decision := range []string{"rejected", "held"} {
		t.Run(decision, func(t *testing.T) {
			h := newRig(t)
			staff := h.login(101)
			customer, user := managementLogin(h, "refusal-"+decision, decision+"-case@example.com")
			start := startCasework(h, staff, user.Email, 990)
			h.expect(h.call("POST", "/api/casework/starts/"+start.ID+"/respond", managementJSON(t, map[string]string{"decision": decision}), customer, nil), 200)
			h.expect(h.call("POST", "/api/casework/"+start.CaseID+"/events", managementJSON(t, caseEventBody(h, "incident", 991)), customer, nil), 409)
			if managementCount(h, "integrity.api_registrations", "subject_id=?", start.ID) != 0 {
				t.Fatal("unapproved case registered")
			}
		})
	}
}
func TestCaseworkRevisionAndExpirationPostgres(t *testing.T) {
	h := newRig(t)
	staff := h.login(101)
	customer, user := managementLogin(h, "revision-customer", "revision-case@example.com")
	start := startCasework(h, staff, user.Email, 1100)
	h.expect(h.call("POST", "/api/casework/starts/"+start.ID+"/respond", `{"decision":"held"}`, customer, nil), 200)
	body := map[string]any{"case_id": start.CaseID, "email": user.Email, "terms": "条件を訂正して再提示", "deadline": time.Now().Add(time.Hour).UTC().Format(time.RFC3339), "request_key": uid(1101)}
	w := h.call("POST", "/api/casework/starts", managementJSON(t, body), staff, nil)
	h.expect(w, 201)
	newStart := managementData[startReceipt](t, w)
	h.expect(h.call("POST", "/api/casework/starts", managementJSON(t, body), staff, nil), 201)
	h.expect(h.call("POST", "/api/casework/starts/"+start.ID+"/respond", `{"decision":"approved"}`, customer, nil), 409)
	h.expect(h.call("POST", "/api/casework/starts/"+newStart.ID+"/respond", `{"decision":"approved"}`, customer, nil), 200)
	request := createEvent(h, customer, start.CaseID, caseEventBody(h, "request", 1102))
	eventAction(h, staff, start.CaseID, request.ID, "returned", 1103, "内容を補足してください", 200)
	revised := caseEventBody(h, "request", 1104)
	revised["supersedes_id"] = request.ID
	newRequest := createEvent(h, customer, start.CaseID, revised)
	same := createEvent(h, customer, start.CaseID, revised)
	if same.ID != newRequest.ID {
		t.Fatal("duplicate revision")
	}
	eventAction(h, staff, start.CaseID, request.ID, "approved", 1105, "", 409)
	eventAction(h, staff, start.CaseID, newRequest.ID, "approved", 1106, "", 200)
	expired := createEvent(h, staff, start.CaseID, caseEventBody(h, "work", 1107))
	h.exec("ALTER TABLE app.case_events DISABLE TRIGGER case_events_fixed")
	h.exec("UPDATE app.case_events SET deadline=now()-interval '1 second' WHERE id=?", expired.ID)
	eventAction(h, customer, start.CaseID, expired.ID, "approved", 1108, "", 409)
	if managementCount(h, "integrity.api_registrations", "subject_id=?", expired.ID) != 0 {
		t.Fatal("expired work queued")
	}
	eventAction(h, staff, start.CaseID, expired.ID, "executed", 1109, "", 409)
}
