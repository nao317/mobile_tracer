package business

import (
	"context"
	"encoding/json"
	"strings"
	"time"
)

// Submit fixes the version before any customer is asked to approve it. The caller
// inserts the presentation and recipient list in the same database transaction.
func (s *Service) Submit(ctx context.Context, p Principal, caseID, recordID, id, key, hash string, lock int) error {
	return s.repo.transaction(ctx, func(r repository) error {
		c, err := r.getCase(ctx, p, caseID, true)
		if err != nil {
			return err
		}
		if !p.canWrite(c) {
			return Forbidden()
		}
		if c.Status != "in_progress" {
			return Conflict("進行中の案件だけ提出できます。")
		}
		v, err := r.getVersion(ctx, p, caseID, recordID, id, true)
		if err != nil {
			return err
		}
		if v.Status != "draft" || v.LockVersion != lock {
			return Conflict("最新の下書きを確認してください。")
		}
		record, err := r.getRecord(ctx, p, caseID, recordID)
		if err != nil {
			return err
		}
		rules, err := r.rules(ctx, p.TenantID, v.ConfigurationVersionID, c.CaseType)
		if err != nil {
			return err
		}
		dto, err := r.versionDTO(ctx, p, v)
		if err != nil {
			return err
		}
		rr, ok := rules.RecordKinds[record.RecordKind]
		if !ok {
			return Conflict("記録種別がありません。")
		}
		if err = validateEntries(dto.Entries, rr); err != nil {
			return err
		}
		for k, f := range rr.Fields {
			raw, ok := dto.Entries[k]
			if f.Required && (!ok || string(raw) == "null" || strings.TrimSpace(string(raw)) == `""`) {
				return Invalid(k, "必須項目を入力してください。")
			}
		}
		vehicle, err := r.getVehicle(ctx, p, c.VehicleID)
		if err != nil {
			return err
		}
		vd, err := r.vehicleDTO(ctx, vehicle)
		if err != nil {
			return err
		}
		data, _ := json.Marshal(vd)
		if err = r.table(ctx, "app.record_versions").Where("id=?", id).Updates(map[string]any{"status": "submitted", "vehicle_snapshot": string(data), "content_hash": hash, "hash_algorithm": "sha256", "submit_idempotency_key": key, "submitted_by": p.StaffID, "submitted_at": time.Now().UTC()}).Error; err != nil {
			return err
		}
		return r.audit(ctx, p, "record.present", "record_version", id, map[string]any{"content_hash": hash})
	})
}

func (s *Service) Correct(ctx context.Context, p Principal, caseID, recordID, id, reason string) (Version, error) {
	var result Version
	if strings.TrimSpace(reason) == "" || len(reason) > 2000 {
		return result, Invalid("reason", "訂正理由を入力してください。")
	}
	err := s.repo.transaction(ctx, func(r repository) error {
		c, err := r.getCase(ctx, p, caseID, true)
		if err != nil {
			return err
		}
		if !p.canWrite(c) {
			return Forbidden()
		}
		if c.Status != "in_progress" {
			return Conflict("進行中の案件だけ訂正できます。")
		}
		old, err := r.getVersion(ctx, p, caseID, recordID, id, true)
		if err != nil {
			return err
		}
		if old.Status != "submitted" {
			return Conflict("提出版を選択してください。")
		}
		var row versionRow
		err = r.db.WithContext(ctx).Raw(`INSERT INTO app.record_versions(tenant_id,case_id,record_id,version_no,configuration_version_id,based_on_version_id,change_kind,change_reason,created_by) SELECT ?,?,?,max(version_no)+1,?,?,'correction',?,? FROM app.record_versions WHERE record_id=? RETURNING *`, p.TenantID, caseID, recordID, c.ConfigurationVersionID, id, reason, p.StaffID, recordID).Scan(&row).Error
		if err != nil {
			return err
		}
		oldDTO, err := r.versionDTO(ctx, p, old)
		if err != nil {
			return err
		}
		if err = r.replaceEntries(ctx, p, row, oldDTO.Entries); err != nil {
			return err
		}
		if err = r.audit(ctx, p, "record.correct", "record_version", row.ID, map[string]any{"based_on": id, "reason": reason}); err != nil {
			return err
		}
		result, err = r.versionDTO(ctx, p, row)
		return err
	})
	return result, err
}
