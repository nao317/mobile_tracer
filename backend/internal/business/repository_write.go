package business

import (
	"context"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func (r repository) insertVehicle(ctx context.Context, p Principal, in VehicleCreate) (vehicleRow, error) {
	var row vehicleRow
	err := r.db.WithContext(ctx).Raw("INSERT INTO app.vehicles (tenant_id, model_name) VALUES (?, ?) RETURNING *", p.TenantID, in.ModelName).Scan(&row).Error
	if err != nil {
		return row, err
	}
	for _, id := range in.Identifiers {
		if err := r.table(ctx, "app.vehicle_identifiers").Create(map[string]any{"tenant_id": p.TenantID, "vehicle_id": row.ID, "kind": id.Kind, "value": id.Value}).Error; err != nil {
			return row, err
		}
	}
	return row, nil
}

func (r repository) updateVehicle(ctx context.Context, p Principal, id string, name *string) error {
	return r.table(ctx, "app.vehicles").Where("tenant_id = ? AND id = ?", p.TenantID, id).Update("model_name", name).Error
}

func (r repository) storeExists(ctx context.Context, p Principal, id string) (bool, error) {
	var count int64
	err := r.table(ctx, "app.stores").Where("tenant_id = ? AND id = ?", p.TenantID, id).Count(&count).Error
	return count == 1, err
}

func (r repository) publishedConfiguration(ctx context.Context, p Principal, id, caseType string) error {
	var cfg struct{ ID string }
	return r.table(ctx, "app.configuration_versions AS cv").Select("cv.id").Joins("JOIN app.configuration_modules cm ON cm.configuration_version_id = cv.id AND cm.tenant_id = cv.tenant_id").Where("cv.tenant_id = ? AND cv.id = ? AND cv.status = 'published' AND cm.business_type = ?", p.TenantID, id, caseType).Take(&cfg).Error
}

func (r repository) insertCase(ctx context.Context, p Principal, in CaseCreate, stage string) (caseRow, error) {
	var row caseRow
	err := r.db.WithContext(ctx).Raw("INSERT INTO app.cases (tenant_id, store_id, vehicle_id, case_type, configuration_version_id, assignee_id, stage, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *", p.TenantID, in.StoreID, in.VehicleID, in.CaseType, in.ConfigurationVersionID, in.AssigneeID, stage, p.StaffID).Scan(&row).Error
	return row, err
}

func (r repository) updateCase(ctx context.Context, p Principal, id string, values map[string]any) error {
	return r.table(ctx, "app.cases").Where("tenant_id = ? AND id = ?", p.TenantID, id).Updates(values).Error
}

func (r repository) insertRecord(ctx context.Context, p Principal, c caseRow, kind string) (recordRow, versionRow, error) {
	var row recordRow
	var version versionRow
	if err := r.db.WithContext(ctx).Raw("INSERT INTO app.records (tenant_id, case_id, record_kind, created_by) VALUES (?, ?, ?, ?) RETURNING *", p.TenantID, c.ID, kind, p.StaffID).Scan(&row).Error; err != nil {
		return row, version, err
	}
	err := r.db.WithContext(ctx).Raw("INSERT INTO app.record_versions (tenant_id, case_id, record_id, version_no, configuration_version_id, created_by) VALUES (?, ?, ?, 1, ?, ?) RETURNING *", p.TenantID, c.ID, row.ID, c.ConfigurationVersionID, p.StaffID).Scan(&version).Error
	return row, version, err
}

func (r repository) getVersion(ctx context.Context, p Principal, caseID, recordID, id string, lock bool) (versionRow, error) {
	var row versionRow
	q := r.table(ctx, "app.record_versions").Where("tenant_id = ? AND case_id = ? AND record_id = ? AND id = ?", p.TenantID, caseID, recordID, id)
	if lock {
		q = q.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	err := q.Take(&row).Error
	return row, err
}

func (r repository) advanceDraft(ctx context.Context, p Principal, id string, lockVersion int) error {
	updated := r.table(ctx, "app.record_versions").Where("tenant_id = ? AND id = ? AND status = 'draft' AND lock_version = ?", p.TenantID, id, lockVersion).Update("lock_version", gorm.Expr("lock_version + 1"))
	if updated.Error != nil {
		return updated.Error
	}
	if updated.RowsAffected != 1 {
		return Conflict("下書きが更新されています。")
	}
	return nil
}
