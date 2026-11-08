package authn_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"firebase.google.com/go/v4/auth"
	"github.com/nao317/mobile_tracer/backend/internal/authn"
)

func managementLogin(h *rig, uid, email string) (jar, authn.ManagedUser) {
	h.t.Helper()
	h.provider.identity = auth.Token{UID: uid, Issuer: h.cfg.FirebaseIssuer(), AuthTime: time.Now().Unix(), Claims: map[string]interface{}{"email": email, "email_verified": true}}
	cookies := h.login()
	var user authn.ManagedUser
	if err := h.db.Table("auth.users").Where("subject=?", uid).Take(&user).Error; err != nil {
		h.t.Fatal(err)
	}
	return cookies, user
}
func managementData[T any](t *testing.T, w *httptest.ResponseRecorder) T {
	t.Helper()
	var body struct {
		Data T `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	return body.Data
}
func managementJSON(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}
func managementRequest(t *testing.T, key, kind string, company *string, payload any) string {
	return managementJSON(t, map[string]any{"request_key": key, "kind": kind, "company_id": company, "payload": payload})
}
func managementCount(h *rig, table, condition string, args ...any) int64 {
	h.t.Helper()
	var n int64
	if err := h.db.Table(table).Where(condition, args...).Count(&n).Error; err != nil {
		h.t.Fatal(err)
	}
	return n
}
func managementCompany(name string, version *int) authn.CompanyInput {
	return authn.CompanyInput{Name: name, Version: version, Profile: authn.CompanyProfile{LegalName: name + "株式会社", Description: "企業紹介", Website: "https://example.com", Phone: "03-1234-5678", Address: "東京都", ContactEmail: "contact@example.com", BusinessTypes: []string{"rental", "repair"}}}
}
func TestManagementWorkflowPostgres(t *testing.T) {
	h := newRig(t)
	applicant, user := managementLogin(h, "management-applicant", "applicant@example.com")
	outsider, _ := managementLogin(h, "management-outsider", "outsider@example.com")
	admin, adminUser := managementLogin(h, "management-admin", "admin@example.com")
	h.expect(h.call("GET", "/api/admin/users", "", applicant, nil), 403)
	h.expect(h.call("GET", "/api/admin/requests", "", nil, nil), 401)
	for _, path := range []string{"overview", "users", "companies", "requests"} {
		h.expect(h.call("GET", "/api/admin/"+path, "", admin, nil), 200)
	}
	h.expect(h.call("POST", "/api/me/requests", managementRequest(t, uid(810), "company_create", nil, managementCompany("権限外", nil)), applicant, nil), 403)
	upgrade := managementRequest(t, uid(811), "business_upgrade", nil, map[string]any{"display_name": "申請者", "reason": "企業の担当者として利用するため"})
	h.expect(h.call("POST", "/api/me/requests", upgrade, applicant, func(r *http.Request) { r.Header.Del("X-CSRF-Token") }), 403)
	w := h.call("POST", "/api/me/requests", upgrade, applicant, nil)
	h.expect(w, 201)
	request := managementData[authn.ManagementRequest](t, w)
	h.expect(h.call("POST", "/api/me/requests", upgrade, applicant, nil), 201)
	if n := managementCount(h, "auth.management_requests", "requester_id=?", user.ID); n != 1 {
		t.Fatalf("duplicate request: %d", n)
	}
	h.expect(h.call("POST", "/api/me/requests", managementRequest(t, uid(812), "business_upgrade", nil, map[string]any{"display_name": "申請者", "reason": "別申請"}), applicant, nil), 409)
	h.expect(h.call("POST", "/api/me/requests", strings.Replace(upgrade, "企業の担当者として利用するため", "変更した申請理由", 1), applicant, nil), 409)
	var current authn.ManagedUser
	h.db.Table("auth.users").Where("id=?", user.ID).Take(&current)
	if current.AccountType != "general" {
		t.Fatal("upgraded before approval")
	}
	otherRequests := h.call("GET", "/api/me/requests", "", outsider, nil)
	h.expect(otherRequests, 200)
	if strings.Contains(otherRequests.Body.String(), request.ID) {
		t.Fatal("leaked another user's request")
	}
	decisionPath := "/api/admin/requests/" + request.ID + "/decision"
	approve := `{"decision":"approved","reason":"内容を確認しました"}`
	h.expect(h.call("POST", decisionPath, approve, applicant, nil), 403)
	h.expect(h.call("POST", decisionPath, `{"decision":"approved","reason":" "}`, admin, nil), 400)
	h.expect(h.call("POST", decisionPath, approve, admin, nil), 200)
	h.expect(h.call("POST", decisionPath, approve, admin, nil), 200)
	h.expect(h.call("POST", decisionPath, `{"decision":"rejected","reason":"変更不可"}`, admin, nil), 409)
	me := h.call("GET", "/api/auth/me", "", applicant, nil)
	h.expect(me, 200)
	if !strings.Contains(me.Body.String(), `"account_type":"business"`) {
		t.Fatal(me.Body.String())
	}
	if n := managementCount(h, "audit.events", "target_id=? AND action='management.request_approved'", request.ID); n != 1 {
		t.Fatalf("duplicate approval audit: %d", n)
	}

	// Creation, membership, configuration and the approval commit together, once.
	create := managementRequest(t, uid(813), "company_create", nil, managementCompany("審査対象企業", nil))
	w = h.call("POST", "/api/me/requests", create, applicant, nil)
	h.expect(w, 201)
	createRequest := managementData[authn.ManagementRequest](t, w)
	if managementCount(h, "app.tenants", "name=?", "審査対象企業") != 0 {
		t.Fatal("created company before approval")
	}
	path := "/api/admin/requests/" + createRequest.ID + "/decision"
	responses := make([]*httptest.ResponseRecorder, 2)
	var wg sync.WaitGroup
	for i := range responses {
		wg.Add(1)
		go func(i int) { defer wg.Done(); responses[i] = h.call("POST", path, approve, admin, nil) }(i)
	}
	wg.Wait()
	for _, response := range responses {
		h.expect(response, 200)
	}
	companyID := managementData[authn.ManagementRequest](t, responses[0]).CompanyID
	if companyID == nil {
		t.Fatal("missing approved company")
	}
	id := *companyID
	h.expect(h.call("POST", "/api/me/requests", create, applicant, nil), 201)
	for _, table := range []string{"app.tenants", "app.company_profiles", "app.stores", "auth.staff_links", "app.configuration_versions"} {
		column := "tenant_id"
		if table == "app.tenants" {
			column = "id"
		}
		if table == "app.company_profiles" {
			column = "company_id"
		}
		if n := managementCount(h, table, column+"=?", id); n != 1 {
			t.Fatalf("%s: %d", table, n)
		}
	}
	h.expect(h.call("GET", "/api/admin/companies?q=審査対象", "", admin, nil), 200)
	w = h.call("GET", "/api/me/companies", "", applicant, nil)
	h.expect(w, 200)
	companies := managementData[[]authn.Company](t, w)
	if len(companies) != 1 || companies[0].Name != "審査対象企業" {
		t.Fatal(w.Body.String())
	}
	var owner struct{ ID, StaffID string }
	h.db.Table("auth.staff_links").Where("user_id=? AND tenant_id=? AND revoked_at IS NULL", user.ID, id).Take(&owner)
	h.expect(h.call("POST", "/api/auth/membership", managementJSON(t, map[string]any{"staff_id": owner.StaffID}), applicant, nil), 200)
	w = h.call("GET", "/api/context", "", applicant, nil)
	h.expect(w, 200)
	if !strings.Contains(w.Body.String(), id) || !strings.Contains(w.Body.String(), "tenant_admin") {
		t.Fatal(w.Body.String())
	}
	h.expect(h.call("POST", "/api/admin/companies/"+id+"/members/"+owner.ID+"/revoke", `{"reason":"最後の管理者を保護"}`, admin, nil), 409)
	zero := 0
	profile := managementCompany("更新された企業", &zero)
	// A general user and a business user belonging to another tenant both fail.
	h.expect(h.call("POST", "/api/me/requests", managementRequest(t, uid(814), "company_profile_update", &id, profile), outsider, nil), 403)
	h.exec("UPDATE auth.users SET account_type='business' WHERE subject=?", "management-outsider")
	h.expect(h.call("POST", "/api/me/requests", managementRequest(t, uid(814), "company_profile_update", &id, profile), outsider, nil), 403)
	w = h.call("GET", "/api/me/companies", "", outsider, nil)
	h.expect(w, 200)
	if len(managementData[[]authn.Company](t, w)) != 0 {
		t.Fatal("leaked company")
	}
	w = h.call("POST", "/api/me/requests", managementRequest(t, uid(815), "company_profile_update", &id, profile), applicant, nil)
	h.expect(w, 201)
	update := managementData[authn.ManagementRequest](t, w)
	h.expect(h.call("POST", "/api/admin/requests/"+update.ID+"/decision", approve, admin, nil), 200)
	w = h.call("GET", "/api/me/companies", "", applicant, nil)
	h.expect(w, 200)
	company := managementData[[]authn.Company](t, w)[0]
	if company.Name != profile.Name || company.Version != 1 {
		t.Fatal(w.Body.String())
	}

	// A newer administrator edit cannot be overwritten by an old pending request.
	one := 1
	stale := managementCompany("競合する変更", &one)
	w = h.call("POST", "/api/me/requests", managementRequest(t, uid(816), "company_profile_update", &id, stale), applicant, nil)
	h.expect(w, 201)
	staleRequest := managementData[authn.ManagementRequest](t, w)
	direct := managementJSON(t, map[string]any{"name": "管理者の最新編集", "profile": stale.Profile, "version": 1, "status": "active"})
	h.expect(h.call("PATCH", "/api/admin/companies/"+id, direct, admin, nil), 200)
	h.expect(h.call("POST", "/api/admin/requests/"+staleRequest.ID+"/decision", approve, admin, nil), 409)
	if managementCount(h, "auth.management_requests", "id=? AND status='pending'", staleRequest.ID) != 1 {
		t.Fatal("stale request was finalized")
	}
	h.expect(h.call("POST", "/api/admin/requests/"+staleRequest.ID+"/decision", `{"decision":"rejected","reason":"最新版に合わせて再申請してください"}`, admin, nil), 200)
	h.expect(h.call("PATCH", "/api/admin/companies/"+id, direct, applicant, nil), 403)

	// Explicit membership administration and safe reactivation preserve identity.
	var outsiderUser authn.ManagedUser
	h.db.Table("auth.users").Where("subject=?", "management-outsider").Take(&outsiderUser)
	memberBody := managementJSON(t, map[string]any{"user_id": outsiderUser.ID, "role": "staff"})
	membersPath := "/api/admin/companies/" + id + "/members"
	h.expect(h.call("POST", membersPath, memberBody, admin, nil), 201)
	var link struct{ ID, StaffID string }
	h.db.Table("auth.staff_links").Where("user_id=? AND tenant_id=? AND revoked_at IS NULL", outsiderUser.ID, id).Take(&link)
	h.expect(h.call("POST", membersPath+"/"+link.ID+"/revoke", `{"reason":"所属解除"}`, admin, nil), 200)
	h.expect(h.call("POST", membersPath, memberBody, admin, nil), 201)
	if managementCount(h, "app.staff_members", "tenant_id=? AND id=?", id, link.StaffID) != 1 || managementCount(h, "auth.staff_links", "tenant_id=? AND user_id=? AND revoked_at IS NULL", id, outsiderUser.ID) != 1 {
		t.Fatal("membership reactivation failed")
	}
	h.expect(h.call("POST", "/api/auth/membership", managementJSON(t, map[string]any{"staff_id": link.StaffID}), outsider, nil), 200)
	h.expect(h.call("GET", "/api/context", "", outsider, nil), 200)
	downgrade := managementJSON(t, map[string]any{"display_name": "一般へ戻す", "account_type": "general", "status": "active", "version": outsiderUser.Version})
	h.expect(h.call("PATCH", "/api/admin/users/"+outsiderUser.ID, downgrade, admin, nil), 200)
	h.expect(h.call("GET", "/api/context", "", outsider, nil), 403)
	if managementCount(h, "auth.staff_links", "user_id=? AND revoked_at IS NULL", outsiderUser.ID) != 0 {
		t.Fatal("downgrade kept an active membership")
	}
	h.expect(h.call("PATCH", "/api/admin/users/"+outsiderUser.ID, downgrade, admin, nil), 409)

	h.expect(h.call("GET", "/api/admin/users?account_type=business&q=applicant", "", admin, nil), 200)
	h.db.Table("auth.users").Where("id=?", user.ID).Take(&current)
	suspend := managementJSON(t, map[string]any{"display_name": current.DisplayName, "account_type": "business", "status": "suspended", "version": current.Version})
	h.expect(h.call("PATCH", "/api/admin/users/"+user.ID, suspend, admin, nil), 200)
	h.expect(h.call("GET", "/api/me/requests", "", applicant, nil), 401)
	selfSuspend := managementJSON(t, map[string]any{"display_name": "管理者", "account_type": "general", "status": "suspended", "version": adminUser.Version})
	h.expect(h.call("PATCH", "/api/admin/users/"+adminUser.ID, selfSuspend, admin, nil), 409)
}

func TestManagementApprovalRollsBackOnAuditFailure(t *testing.T) {
	h := newRig(t)
	applicant, user := managementLogin(h, "rollback-applicant", "rollback@example.com")
	admin, _ := managementLogin(h, "rollback-admin", "admin@example.com")
	w := h.call("POST", "/api/me/requests", managementRequest(t, uid(820), "business_upgrade", nil, map[string]any{"display_name": "申請者", "reason": "利用申請"}), applicant, nil)
	h.expect(w, 201)
	request := managementData[authn.ManagementRequest](t, w)
	h.exec(`CREATE FUNCTION audit.test_fail_management() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='management.request_approved' THEN RAISE EXCEPTION 'test audit unavailable' USING ERRCODE='XX000'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_fail_management BEFORE INSERT ON audit.events FOR EACH ROW EXECUTE FUNCTION audit.test_fail_management()`)
	w = h.call("POST", fmt.Sprintf("/api/admin/requests/%s/decision", request.ID), `{"decision":"approved","reason":"確認済み"}`, admin, nil)
	h.expect(w, 500)
	if managementCount(h, "auth.users", "id=? AND account_type='general'", user.ID) != 1 || managementCount(h, "auth.management_requests", "id=? AND status='pending'", request.ID) != 1 {
		t.Fatal("approval escaped rollback")
	}
}
