package business

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Persistence rows are deliberately separate from the HTTP request/response types.
type vehicleRow struct {
	ID, TenantID string
	ModelName    *string
	CreatedAt    time.Time
}

type identifierRow struct {
	ID, TenantID, VehicleID, Kind, Value string
	ValidFrom, ValidTo, VerifiedAt       *time.Time
}

type caseRow struct {
	ID, TenantID, StoreID, VehicleID, CaseType, ConfigurationVersionID string
	AssigneeID                                                         *string
	Stage, Status                                                      string
	CancelReason, CancelledBy                                          *string
	CancelledAt                                                        *time.Time
	CreatedBy                                                          string
	CreatedAt                                                          time.Time
}

type recordRow struct {
	ID, TenantID, CaseID, RecordKind, CreatedBy string
	CreatedAt                                   time.Time
}

type versionRow struct {
	ID, TenantID, CaseID, RecordID, ConfigurationVersionID                              string
	VersionNo, LockVersion                                                              int
	Status                                                                              string
	BasedOnVersionID, ChangeKind, ChangeReason, SubmittedBy, ContentHash, HashAlgorithm *string
	SubmittedAt                                                                         *time.Time
	VehicleSnapshot                                                                     json.RawMessage
	CreatedBy                                                                           string
	CreatedAt                                                                           time.Time
}

type repository struct{ db *gorm.DB }

// Read the version counter and entry values from the same committed snapshot.
func snapshot[T any](ctx context.Context, r repository, read func(repository) (T, error)) (T, error) {
	var result T
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var err error
		result, err = read(repository{tx})
		return err
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, err
}

func (r repository) transaction(ctx context.Context, fn func(repository) error) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error { return fn(repository{tx}) })
}

func (r repository) table(ctx context.Context, name string) *gorm.DB {
	return r.db.WithContext(ctx).Table(name)
}

// Store permission alone does not give a staff member access to every case.
func caseScope(q *gorm.DB, p Principal, alias string, write bool) *gorm.DB {
	q = q.Where(alias+".tenant_id = ?", p.TenantID)
	access := q.Session(&gorm.Session{NewDB: true}).Where("1=0")
	for _, role := range p.Roles {
		if write && role.Role == "auditor" {
			continue
		}
		term := q.Session(&gorm.Session{NewDB: true}).Where("1=1")
		if role.StoreID != nil {
			term = term.Where(alias+".store_id = ?", *role.StoreID)
		}
		if role.Role == "staff" {
			term = term.Where("("+alias+".assignee_id = ? OR "+alias+".created_by = ?)", p.StaffID, p.StaffID)
		}
		access = access.Or(term)
	}
	return q.Where(access)
}

func vehicleScope(q *gorm.DB, p Principal) *gorm.DB {
	q = q.Where("v.tenant_id = ?", p.TenantID)
	if p.globalRead() {
		return q
	}
	sub := caseScope(q.Session(&gorm.Session{NewDB: true}).Table("app.cases AS c").Select("1"), p, "c", false).
		Where("c.vehicle_id = v.id")
	return q.Where("EXISTS (?)", sub)
}

func (r repository) getVehicle(ctx context.Context, p Principal, id string) (vehicleRow, error) {
	var row vehicleRow
	err := vehicleScope(r.table(ctx, "app.vehicles AS v"), p).Where("v.id = ?", id).Take(&row).Error
	return row, err
}

func (r repository) vehicleDTO(ctx context.Context, row vehicleRow) (Vehicle, error) {
	var ids []identifierRow
	err := r.table(ctx, "app.vehicle_identifiers").Where("tenant_id = ? AND vehicle_id = ?", row.TenantID, row.ID).
		Order("created_at, id").Find(&ids).Error
	result := Vehicle{ID: row.ID, ModelName: row.ModelName, CreatedAt: row.CreatedAt, Identifiers: []Identifier{}}
	for _, id := range ids {
		result.Identifiers = append(result.Identifiers, Identifier{ID: id.ID, Kind: id.Kind, Value: id.Value,
			ValidFrom: id.ValidFrom, ValidTo: id.ValidTo, VerifiedAt: id.VerifiedAt})
	}
	return result, err
}

func (r repository) getCase(ctx context.Context, p Principal, id string, lock bool) (caseRow, error) {
	var row caseRow
	q := caseScope(r.table(ctx, "app.cases AS c"), p, "c", false).Where("c.id = ?", id)
	if lock {
		q = q.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	err := q.Take(&row).Error
	return row, err
}

func caseDTO(row caseRow) Case {
	return Case{ID: row.ID, StoreID: row.StoreID, VehicleID: row.VehicleID, CaseType: row.CaseType,
		ConfigurationVersionID: row.ConfigurationVersionID, AssigneeID: row.AssigneeID, Stage: row.Stage,
		Status: row.Status, CancelReason: row.CancelReason, CancelledBy: row.CancelledBy, CancelledAt: row.CancelledAt,
		CreatedBy: row.CreatedBy, CreatedAt: row.CreatedAt}
}

func recordDTO(row recordRow) Record {
	return Record{ID: row.ID, CaseID: row.CaseID, RecordKind: row.RecordKind, CreatedBy: row.CreatedBy, CreatedAt: row.CreatedAt}
}

func (r repository) getRecord(ctx context.Context, p Principal, caseID, recordID string) (recordRow, error) {
	var row recordRow
	err := r.table(ctx, "app.records").Where("tenant_id = ? AND case_id = ? AND id = ?", p.TenantID, caseID, recordID).Take(&row).Error
	return row, err
}

func (r repository) versionDTO(ctx context.Context, p Principal, row versionRow) (Version, error) {
	var entries []struct {
		ItemKey string
		Value   json.RawMessage
	}
	err := r.table(ctx, "app.record_entries").Where("tenant_id = ? AND case_id = ? AND record_version_id = ?", p.TenantID, row.CaseID, row.ID).
		Order("item_key").Find(&entries).Error
	v := Version{ID: row.ID, CaseID: row.CaseID, RecordID: row.RecordID, VersionNo: row.VersionNo,
		Status: row.Status, ConfigurationVersionID: row.ConfigurationVersionID, LockVersion: row.LockVersion,
		BasedOnVersionID: row.BasedOnVersionID, ChangeKind: row.ChangeKind, ChangeReason: row.ChangeReason,
		SubmittedBy: row.SubmittedBy, SubmittedAt: row.SubmittedAt, ContentHash: row.ContentHash, HashAlgorithm: row.HashAlgorithm,
		VehicleSnapshot: row.VehicleSnapshot, CreatedBy: row.CreatedBy, CreatedAt: row.CreatedAt, Entries: map[string]json.RawMessage{}}
	for _, e := range entries {
		v.Entries[e.ItemKey] = e.Value
	}
	return v, err
}

func (r repository) audit(ctx context.Context, p Principal, action, kind, id string, details any) error {
	// Hash a stable representation of the event; hash-chain linking is not implemented.
	event := struct {
		TenantID, ActorID, Action, Kind, ID string
		At                                  time.Time
		Details                             any
	}{p.TenantID, p.StaffID, action, kind, id, time.Now().UTC(), details}
	data, err := json.Marshal(event)
	if err != nil {
		return err
	}
	detailJSON, err := json.Marshal(details)
	if err != nil {
		return err
	}
	hash := sha256.Sum256(data)
	return r.table(ctx, "audit.events").Create(map[string]any{
		"tenant_id": p.TenantID, "actor_type": "staff", "actor_id": p.StaffID,
		"action": action, "target_type": kind, "target_id": id, "result": "succeeded",
		"created_at": event.At, "details": string(detailJSON), "entry_hash": hex.EncodeToString(hash[:]),
	}).Error
}

func paginate(q *gorm.DB, options ListOptions, alias string) *gorm.DB {
	column := options.Sort
	desc := false
	if len(column) > 0 && column[0] == '-' {
		desc = true
		column = column[1:]
	}
	return q.Order(clause.OrderByColumn{Column: clause.Column{Table: alias, Name: column}, Desc: desc}).
		Order(clause.OrderByColumn{Column: clause.Column{Table: alias, Name: "id"}}).
		Limit(options.PageSize).Offset((options.Page - 1) * options.PageSize)
}
