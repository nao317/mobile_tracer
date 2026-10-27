package business

import (
	"context"
	"encoding/json"
	"gorm.io/gorm"
	"strings"
)

func (r repository) resolveStaff(ctx context.Context, id string) (Principal, error) {
	var row struct{ ID, TenantID string }
	err := r.table(ctx, "app.staff_members AS s").Select("s.id, s.tenant_id").
		Joins("JOIN app.tenants t ON t.id = s.tenant_id").
		Where("s.id = ? AND s.status = 'active' AND t.status = 'active'", id).Take(&row).Error
	if err == gorm.ErrRecordNotFound {
		return Principal{}, Forbidden()
	}
	if err != nil {
		return Principal{}, err
	}
	p := Principal{TenantID: row.TenantID, StaffID: row.ID, Roles: []Role{}}
	err = r.table(ctx, "app.staff_role_assignments").Select("role, store_id").
		Where("tenant_id = ? AND staff_id = ? AND revoked_at IS NULL", p.TenantID, p.StaffID).Order("role, store_id").Find(&p.Roles).Error
	if err != nil {
		return Principal{}, err
	}
	if len(p.Roles) == 0 {
		return Principal{}, Forbidden()
	}
	return p, nil
}

func (r repository) contextData(ctx context.Context, p Principal) (Context, error) {
	result := Context{Principal: p, Stores: []Store{}}
	var stores []Store
	if err := r.table(ctx, "app.stores").Select("id, name").Where("tenant_id = ?", p.TenantID).Order("name, id").Find(&stores).Error; err != nil {
		return result, err
	}
	for _, store := range stores {
		if p.allowedStore(store.ID, false, false) {
			result.Stores = append(result.Stores, store)
		}
	}
	var config Configuration
	err := r.table(ctx, "app.configuration_versions").Select("id, settings").Where("tenant_id = ? AND status = 'published'", p.TenantID).Take(&config).Error
	if err != nil && err != gorm.ErrRecordNotFound {
		return result, err
	}
	if err == nil {
		result.Configuration = &config
	}
	return result, nil
}

func (r repository) listVehicles(ctx context.Context, p Principal, o ListOptions) (Page[Vehicle], error) {
	result := Page[Vehicle]{Data: []Vehicle{}, Pagination: Pagination{Page: o.Page, PageSize: o.PageSize}}
	err := r.transaction(ctx, func(r repository) error {
		q := vehicleScope(r.table(ctx, "app.vehicles AS v"), p)
		if o.Query != "" {
			q = q.Where("(v.model_name ILIKE ? OR EXISTS (SELECT 1 FROM app.vehicle_identifiers i WHERE i.tenant_id = v.tenant_id AND i.vehicle_id = v.id AND i.value ILIKE ?))", "%"+escapeLike(o.Query)+"%", "%"+escapeLike(o.Query)+"%")
		}
		if err := q.Count(&result.Pagination.Total).Error; err != nil {
			return err
		}
		var rows []vehicleRow
		if err := paginate(q, o, "v").Find(&rows).Error; err != nil {
			return err
		}
		for _, row := range rows {
			v, err := r.vehicleDTO(ctx, row)
			if err != nil {
				return err
			}
			result.Data = append(result.Data, v)
		}
		return nil
	})
	return result, err
}

func (r repository) listCases(ctx context.Context, p Principal, o ListOptions) (Page[Case], error) {
	result := Page[Case]{Data: []Case{}, Pagination: Pagination{Page: o.Page, PageSize: o.PageSize}}
	q := caseScope(r.table(ctx, "app.cases AS c"), p, "c", false)
	for key, value := range o.Filters {
		q = q.Where("c."+key+" = ?", value)
	}
	if o.Query != "" {
		q = q.Where("EXISTS (SELECT 1 FROM app.vehicles v WHERE v.id = c.vehicle_id AND v.tenant_id = c.tenant_id AND v.model_name ILIKE ?)", "%"+escapeLike(o.Query)+"%")
	}
	if err := q.Count(&result.Pagination.Total).Error; err != nil {
		return result, err
	}
	var rows []caseRow
	if err := paginate(q, o, "c").Find(&rows).Error; err != nil {
		return result, err
	}
	for _, row := range rows {
		result.Data = append(result.Data, caseDTO(row))
	}
	return result, nil
}

func (r repository) listRecords(ctx context.Context, p Principal, caseID string, o ListOptions) (Page[Record], error) {
	result := Page[Record]{Data: []Record{}, Pagination: Pagination{Page: o.Page, PageSize: o.PageSize}}
	if _, err := r.getCase(ctx, p, caseID, false); err != nil {
		return result, err
	}
	q := r.table(ctx, "app.records AS r").Where("r.tenant_id = ? AND r.case_id = ?", p.TenantID, caseID)
	if value := o.Filters["record_kind"]; value != "" {
		q = q.Where("r.record_kind = ?", value)
	}
	if err := q.Count(&result.Pagination.Total).Error; err != nil {
		return result, err
	}
	var rows []recordRow
	if err := paginate(q, o, "r").Find(&rows).Error; err != nil {
		return result, err
	}
	for _, row := range rows {
		result.Data = append(result.Data, recordDTO(row))
	}
	return result, nil
}

func (r repository) listVersions(ctx context.Context, p Principal, caseID, recordID string, o ListOptions) (Page[Version], error) {
	result := Page[Version]{Data: []Version{}, Pagination: Pagination{Page: o.Page, PageSize: o.PageSize}}
	if _, err := r.authorizedRecord(ctx, p, caseID, recordID); err != nil {
		return result, err
	}
	q := r.table(ctx, "app.record_versions AS rv").Where("rv.tenant_id = ? AND rv.case_id = ? AND rv.record_id = ?", p.TenantID, caseID, recordID)
	if value := o.Filters["status"]; value != "" {
		q = q.Where("rv.status = ?", value)
	}
	if err := q.Count(&result.Pagination.Total).Error; err != nil {
		return result, err
	}
	var rows []versionRow
	if err := paginate(q, o, "rv").Find(&rows).Error; err != nil {
		return result, err
	}
	for _, row := range rows {
		v, err := r.versionDTO(ctx, p, row)
		if err != nil {
			return result, err
		}
		result.Data = append(result.Data, v)
	}
	return result, nil
}

func (r repository) getVersionDTO(ctx context.Context, p Principal, caseID, recordID, id string) (Version, error) {
	if _, err := r.authorizedRecord(ctx, p, caseID, recordID); err != nil {
		return Version{}, err
	}
	var row versionRow
	if err := r.table(ctx, "app.record_versions").Where("tenant_id = ? AND case_id = ? AND record_id = ? AND id = ?", p.TenantID, caseID, recordID, id).Take(&row).Error; err != nil {
		return Version{}, err
	}
	return r.versionDTO(ctx, p, row)
}

func (r repository) replaceEntries(ctx context.Context, p Principal, row versionRow, entries map[string]json.RawMessage) error {
	if err := r.table(ctx, "app.record_entries").Where("tenant_id = ? AND case_id = ? AND record_version_id = ?", p.TenantID, row.CaseID, row.ID).Delete(&struct{}{}).Error; err != nil {
		return err
	}
	for key, value := range entries {
		if err := r.table(ctx, "app.record_entries").Create(map[string]any{"tenant_id": p.TenantID, "case_id": row.CaseID, "record_version_id": row.ID, "item_key": key, "value": string(value)}).Error; err != nil {
			return err
		}
	}
	return nil
}

func escapeLike(s string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(s)
}

func (r repository) authorizedRecord(ctx context.Context, p Principal, caseID, recordID string) (recordRow, error) {
	if _, err := r.getCase(ctx, p, caseID, false); err != nil {
		return recordRow{}, err
	}
	return r.getRecord(ctx, p, caseID, recordID)
}

func (r repository) rules(ctx context.Context, tenantID, configurationID, caseType string) (businessRules, error) {
	var row struct{ Settings json.RawMessage }
	err := r.table(ctx, "app.configuration_versions").Select("settings").
		Where("tenant_id = ? AND id = ?", tenantID, configurationID).Take(&row).Error
	if err != nil {
		return businessRules{}, err
	}
	return parseRules(row.Settings, caseType)
}
