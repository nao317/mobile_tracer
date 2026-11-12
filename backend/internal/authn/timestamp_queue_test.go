package authn_test

import (
	"context"
	"strings"
	"sync"
	"testing"

	"github.com/nao317/mobile_tracer/backend/internal/tapyrusapi"
)

type timestampMock struct {
	mu          sync.Mutex
	created     int
	gets        int
	finds       int
	stored      map[int64]tapyrusapi.Timestamp
	lose        bool
	confirmed   bool
	unavailable bool
	initial     bool
}

func (m *timestampMock) Create(_ context.Context, hash string) (tapyrusapi.Timestamp, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.created++
	id := int64(m.created)
	v := tapyrusapi.Timestamp{ID: id, Version: "2", ContentHash: hash, Prefix: tapyrusapi.Prefix, Type: "simple", Txid: strings.Repeat("a", 64), Status: "unconfirmed"}
	if m.initial {
		v.Status = "init"
	}
	if m.stored == nil {
		m.stored = map[int64]tapyrusapi.Timestamp{}
	}
	m.stored[id] = v
	if m.lose {
		return tapyrusapi.Timestamp{}, tapyrusapi.ErrUncertain
	}
	return v, nil
}
func (m *timestampMock) Get(_ context.Context, id int64) (tapyrusapi.Timestamp, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.gets++
	if m.unavailable {
		return tapyrusapi.Timestamp{}, tapyrusapi.ErrUncertain
	}
	v := m.stored[id]
	if m.confirmed {
		height, at := int64(123), int64(1794170000)
		v.Status = "confirmed"
		v.BlockHeight = &height
		v.BlockTime = &at
	}
	return v, nil
}
func (m *timestampMock) Find(_ context.Context, hash string) (*tapyrusapi.Timestamp, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.finds++
	if m.unavailable {
		return nil, tapyrusapi.ErrUncertain
	}
	for _, v := range m.stored {
		if v.ContentHash == hash {
			copy := v
			return &copy, nil
		}
	}
	return nil, tapyrusapi.ErrUncertain
}
func ageTimestampQueue(h *rig) {
	h.t.Helper()
	h.exec("UPDATE integrity.api_registrations SET updated_at=now()-interval '1 minute' WHERE status<>'confirmed'")
}
func TestTimestampQueueInitResponsePostgres(t *testing.T) {
	h := newRig(t)
	staff := h.login(101)
	customer, user := managementLogin(h, "timestamp-init-customer", "timestamp-init@example.com")
	start := startCasework(h, staff, user.Email, 996)
	h.expect(h.call("POST", "/api/casework/starts/"+start.ID+"/respond", `{"decision":"approved"}`, customer, nil), 200)
	mock := &timestampMock{initial: true}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	h.service.StartTimestampWorkflow(ctx, mock, "https://example.invalid")
	// A newly queued request is sent without waiting for the 30 second interval.
	if e := h.service.ProcessTimestampQueue(t.Context()); e != nil {
		t.Fatal(e)
	}
	if mock.created != 1 || managementCount(h, "integrity.api_registrations", "subject_id=? AND status='unconfirmed' AND timestamp_id IS NOT NULL", start.ID) != 1 {
		t.Fatal("init response was not kept as unconfirmed")
	}
	mock.confirmed = true
	ageTimestampQueue(h)
	if e := h.service.ProcessTimestampQueue(t.Context()); e != nil {
		t.Fatal(e)
	}
	if mock.created != 1 || mock.finds != 0 || managementCount(h, "integrity.api_registrations", "subject_id=? AND status='confirmed'", start.ID) != 1 {
		t.Fatal("init registration was not confirmed by its ID")
	}
}
func TestTimestampQueueRecoveryPostgres(t *testing.T) {
	h := newRig(t)
	staff := h.login(101)
	customer, user := managementLogin(h, "timestamp-customer", "timestamp@example.com")
	start := startCasework(h, staff, user.Email, 995)
	h.expect(h.call("POST", "/api/casework/starts/"+start.ID+"/respond", `{"decision":"approved"}`, customer, nil), 200)
	mock := &timestampMock{lose: true}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	h.service.StartTimestampWorkflow(ctx, mock, "https://example.invalid")
	ageTimestampQueue(h)
	if e := h.service.ProcessTimestampQueue(t.Context()); e != nil {
		t.Fatal(e)
	}
	if managementCount(h, "integrity.api_registrations", "subject_id=? AND status='unknown'", start.ID) != 1 {
		t.Fatal("lost response not held for recovery")
	}
	mock.unavailable = true
	ageTimestampQueue(h)
	if e := h.service.ProcessTimestampQueue(t.Context()); e != nil {
		t.Fatal(e)
	}
	mock.unavailable = false
	ageTimestampQueue(h)
	if e := h.service.ProcessTimestampQueue(t.Context()); e != nil {
		t.Fatal(e)
	}
	if mock.created != 1 || mock.finds != 2 {
		t.Fatal("uncertain registration was submitted twice")
	}
	mock.confirmed = true
	ageTimestampQueue(h)
	if e := h.service.ProcessTimestampQueue(t.Context()); e != nil {
		t.Fatal(e)
	}
	if managementCount(h, "integrity.api_registrations", "subject_id=? AND status='confirmed'", start.ID) != 1 {
		t.Fatal("confirmation not recorded")
	}
	var job struct{ ID string }
	h.db.Table("integrity.api_registrations").Where("subject_id=?", start.ID).Take(&job)
	w := h.call("POST", "/api/casework/"+start.CaseID+"/verify/"+job.ID, "{}", customer, nil)
	h.expect(w, 200)
	if !strings.Contains(w.Body.String(), `"match"`) {
		t.Fatal(w.Body.String())
	}
	h.exec("ALTER TABLE app.case_start_requests DISABLE TRIGGER case_start_requests_fixed")
	h.exec("UPDATE app.case_start_requests SET terms=? WHERE id=?", []byte(`{"changed":true}`), start.ID)
	w = h.call("POST", "/api/casework/"+start.CaseID+"/verify/"+job.ID, "{}", customer, nil)
	h.expect(w, 200)
	if !strings.Contains(w.Body.String(), `"mismatch"`) {
		t.Fatal(w.Body.String())
	}
}
