package business

import (
	"context"
	"strings"
	"time"

	"gorm.io/gorm"
)

type Service struct{ repo repository }

func New(db *gorm.DB) *Service { return &Service{repo: repository{db}} }

// ResolveStaff uses a server-configured identity, never a tenant/staff ID from a request.
func (s *Service) ResolveStaff(ctx context.Context, id string) (Principal, error) {
	return s.repo.resolveStaff(ctx, id)
}

func (s *Service) Context(ctx context.Context, p Principal) (Context, error) {
	return s.repo.contextData(ctx, p)
}

func (s *Service) Vehicle(ctx context.Context, p Principal, id string) (Vehicle, error) {
	row, err := s.repo.getVehicle(ctx, p, id)
	if err != nil {
		return Vehicle{}, err
	}
	return s.repo.vehicleDTO(ctx, row)
}

func (s *Service) Vehicles(ctx context.Context, p Principal, o ListOptions) (Page[Vehicle], error) {
	return s.repo.listVehicles(ctx, p, o)
}

func (s *Service) CreateVehicle(ctx context.Context, p Principal, in VehicleCreate) (Vehicle, error) {
	if !p.admin() {
		return Vehicle{}, Forbidden()
	}
	if in.ModelName != nil {
		if err := checkText("model_name", *in.ModelName, 200); err != nil {
			return Vehicle{}, err
		}
	}
	if len(in.Identifiers) > 10 {
		return Vehicle{}, Invalid("identifiers", "識別情報は10件以内にしてください。")
	}
	for _, id := range in.Identifiers {
		if id.Kind != "chassis_number" && id.Kind != "vin" && id.Kind != "plate_number" {
			return Vehicle{}, Invalid("identifiers", "識別情報の種類が不正です。")
		}
		if err := checkText("identifiers", id.Value, 100); err != nil {
			return Vehicle{}, err
		}
	}
	var result Vehicle
	err := s.repo.transaction(ctx, func(r repository) error {
		row, err := r.insertVehicle(ctx, p, in)
		if err != nil {
			return err
		}
		if err := r.audit(ctx, p, "vehicle.create", "vehicle", row.ID, map[string]any{"model_name": in.ModelName}); err != nil {
			return err
		}
		result, err = r.vehicleDTO(ctx, row)
		return err
	})
	return result, err
}

func (s *Service) UpdateVehicle(ctx context.Context, p Principal, id string, in VehiclePatch) (Vehicle, error) {
	if !p.admin() {
		return Vehicle{}, Forbidden()
	}
	if !in.ModelName.Set {
		return Vehicle{}, Invalid("body", "更新する項目を指定してください。")
	}
	if in.ModelName.Value != nil {
		if err := checkText("model_name", *in.ModelName.Value, 200); err != nil {
			return Vehicle{}, err
		}
	}
	var result Vehicle
	err := s.repo.transaction(ctx, func(r repository) error {
		row, err := r.getVehicle(ctx, p, id)
		if err != nil {
			return err
		}
		if err := r.updateVehicle(ctx, p, id, in.ModelName.Value); err != nil {
			return err
		}
		if err := r.audit(ctx, p, "vehicle.update", "vehicle", id, map[string]any{"model_name": in.ModelName.Value}); err != nil {
			return err
		}
		row.ModelName = in.ModelName.Value
		result, err = r.vehicleDTO(ctx, row)
		return err
	})
	return result, err
}

func (s *Service) Case(ctx context.Context, p Principal, id string) (Case, error) {
	row, err := s.repo.getCase(ctx, p, id, false)
	return caseDTO(row), err
}

func (s *Service) Cases(ctx context.Context, p Principal, o ListOptions) (Page[Case], error) {
	return s.repo.listCases(ctx, p, o)
}

func (r repository) assignee(ctx context.Context, p Principal, storeID string, id *string) error {
	if id == nil {
		return nil
	}
	if err := checkID("assignee_id", *id); err != nil {
		return err
	}
	other, err := (&Service{repo: r}).ResolveStaff(ctx, *id)
	if err != nil {
		if PublicError(err).Status < 500 {
			return Invalid("assignee_id", "有効な担当者を指定してください。")
		}
		return err
	}
	if other.TenantID != p.TenantID || !other.allowedStore(storeID, true, false) {
		return Invalid("assignee_id", "対象店舗を担当できる担当者を指定してください。")
	}
	return nil
}

func (s *Service) CreateCase(ctx context.Context, p Principal, in CaseCreate) (Case, error) {
	for key, value := range map[string]string{"store_id": in.StoreID, "vehicle_id": in.VehicleID, "configuration_version_id": in.ConfigurationVersionID} {
		if err := checkID(key, value); err != nil {
			return Case{}, err
		}
	}
	if !p.allowedStore(in.StoreID, true, false) {
		return Case{}, Forbidden()
	}
	if in.CaseType != "rental" && in.CaseType != "dealer" && in.CaseType != "repair" {
		return Case{}, Invalid("case_type", "rental・dealer・repairのいずれかを指定してください。")
	}
	if !p.allowedStore(in.StoreID, true, true) && in.AssigneeID != nil && !strings.EqualFold(*in.AssigneeID, p.StaffID) {
		return Case{}, Forbidden()
	}
	var result Case
	err := s.repo.transaction(ctx, func(r repository) error {
		if _, err := r.getVehicle(ctx, p, in.VehicleID); err != nil {
			return err
		}
		exists, err := r.storeExists(ctx, p, in.StoreID)
		if err != nil {
			return err
		}
		if !exists {
			return Invalid("store_id", "対象店舗が見つかりません。")
		}
		if err := r.publishedConfiguration(ctx, p, in.ConfigurationVersionID, in.CaseType); err != nil {
			if err == gorm.ErrRecordNotFound {
				return Invalid("configuration_version_id", "対象業態の反映済み構成版を指定してください。")
			}
			return err
		}
		b, err := r.rules(ctx, p.TenantID, in.ConfigurationVersionID, in.CaseType)
		if err != nil {
			return err
		}
		if err := r.assignee(ctx, p, in.StoreID, in.AssigneeID); err != nil {
			return err
		}
		row, err := r.insertCase(ctx, p, in, b.Stages[0])
		if err != nil {
			return err
		}
		if err := r.audit(ctx, p, "case.create", "case", row.ID, map[string]any{"store_id": in.StoreID, "vehicle_id": in.VehicleID}); err != nil {
			return err
		}
		result = caseDTO(row)
		return nil
	})
	return result, err
}

func (s *Service) UpdateCase(ctx context.Context, p Principal, id string, in CasePatch) (Case, error) {
	if !in.AssigneeID.Set && !in.Stage.Set {
		return Case{}, Invalid("body", "更新する項目を指定してください。")
	}
	if in.Stage.Set && (in.Stage.Value == nil || checkText("stage", *in.Stage.Value, 100) != nil) {
		return Case{}, Invalid("stage", "業務段階を指定してください。")
	}
	var result Case
	err := s.repo.transaction(ctx, func(r repository) error {
		row, err := r.getCase(ctx, p, id, true)
		if err != nil {
			return err
		}
		if !p.canWrite(row) || in.AssigneeID.Set && !p.allowedStore(row.StoreID, true, true) {
			return Forbidden()
		}
		if row.Status != "in_progress" {
			return Conflict("完了・中止済みの案件は変更できません。")
		}
		values := map[string]any{}
		if in.AssigneeID.Set {
			if err := r.assignee(ctx, p, row.StoreID, in.AssigneeID.Value); err != nil {
				return err
			}
			values["assignee_id"] = in.AssigneeID.Value
		}
		if in.Stage.Set {
			b, err := r.rules(ctx, p.TenantID, row.ConfigurationVersionID, row.CaseType)
			if err != nil {
				return err
			}
			// Approval-dependent transitions require their own workflow API and are not inferred here.
			allowed := *in.Stage.Value == row.Stage
			for _, next := range b.Transitions[row.Stage] {
				if next == *in.Stage.Value {
					allowed = true
				}
			}
			if !allowed {
				return Conflict("構成版で許可されていない業務段階への移行です。")
			}
			values["stage"] = *in.Stage.Value
		}
		if err := r.updateCase(ctx, p, id, values); err != nil {
			return err
		}
		if err := r.audit(ctx, p, "case.update", "case", id, values); err != nil {
			return err
		}
		row, err = r.getCase(ctx, p, id, false)
		result = caseDTO(row)
		return err
	})
	return result, err
}

func (s *Service) CancelCase(ctx context.Context, p Principal, id string, in CancelCase) (Case, error) {
	if err := checkText("reason", in.Reason, 2000); err != nil {
		return Case{}, err
	}
	var result Case
	err := s.repo.transaction(ctx, func(r repository) error {
		row, err := r.getCase(ctx, p, id, true)
		if err != nil {
			return err
		}
		if !p.allowedStore(row.StoreID, true, true) {
			return Forbidden()
		}
		if row.Status != "in_progress" {
			return Conflict("完了・中止済みの案件は変更できません。")
		}
		values := map[string]any{"status": "cancelled", "cancel_reason": in.Reason, "cancelled_by": p.StaffID, "cancelled_at": time.Now().UTC()}
		if err := r.updateCase(ctx, p, id, values); err != nil {
			return err
		}
		if err := r.audit(ctx, p, "case.cancel", "case", id, map[string]any{"reason": in.Reason}); err != nil {
			return err
		}
		row, err = r.getCase(ctx, p, id, false)
		result = caseDTO(row)
		return err
	})
	return result, err
}

func (s *Service) Record(ctx context.Context, p Principal, caseID, id string) (Record, error) {
	if _, err := s.repo.getCase(ctx, p, caseID, false); err != nil {
		return Record{}, err
	}
	row, err := s.repo.getRecord(ctx, p, caseID, id)
	return recordDTO(row), err
}

func (s *Service) Records(ctx context.Context, p Principal, caseID string, o ListOptions) (Page[Record], error) {
	return s.repo.listRecords(ctx, p, caseID, o)
}

func (s *Service) CreateRecord(ctx context.Context, p Principal, caseID string, in RecordCreate) (RecordCreated, error) {
	if err := checkText("record_kind", in.RecordKind, 100); err != nil {
		return RecordCreated{}, err
	}
	var result RecordCreated
	err := s.repo.transaction(ctx, func(r repository) error {
		c, err := r.getCase(ctx, p, caseID, true)
		if err != nil {
			return err
		}
		if !p.canWrite(c) {
			return Forbidden()
		}
		if c.Status != "in_progress" {
			return Conflict("完了・中止済みの案件には記録を追加できません。")
		}
		b, err := r.rules(ctx, p.TenantID, c.ConfigurationVersionID, c.CaseType)
		if err != nil {
			return err
		}
		rules, ok := b.RecordKinds[in.RecordKind]
		if !ok {
			return Invalid("record_kind", "構成版にある記録種別を指定してください。")
		}
		if err := validateEntries(in.Entries, rules); err != nil {
			return err
		}
		row, version, err := r.insertRecord(ctx, p, c, in.RecordKind)
		if err != nil {
			return err
		}
		if err := r.replaceEntries(ctx, p, version, in.Entries); err != nil {
			return err
		}
		if err := r.audit(ctx, p, "record.create", "record", row.ID, map[string]any{"version_id": version.ID}); err != nil {
			return err
		}
		result.Record = recordDTO(row)
		result.Draft, err = r.versionDTO(ctx, p, version)
		return err
	})
	return result, err
}

func (s *Service) Versions(ctx context.Context, p Principal, caseID, recordID string, o ListOptions) (Page[Version], error) {
	return snapshot(ctx, s.repo, func(r repository) (Page[Version], error) { return r.listVersions(ctx, p, caseID, recordID, o) })
}

func (s *Service) Version(ctx context.Context, p Principal, caseID, recordID, id string) (Version, error) {
	return snapshot(ctx, s.repo, func(r repository) (Version, error) { return r.getVersionDTO(ctx, p, caseID, recordID, id) })
}

func (s *Service) UpdateDraft(ctx context.Context, p Principal, caseID, recordID, id string, in DraftUpdate) (Version, error) {
	if in.LockVersion == nil || *in.LockVersion < 0 {
		return Version{}, Invalid("lock_version", "0以上の現在の版番号を指定してください。")
	}
	if in.Entries == nil {
		return Version{}, Invalid("entries", "項目のオブジェクトを指定してください。")
	}
	var result Version
	err := s.repo.transaction(ctx, func(r repository) error {
		// Lock order is always case -> version -> entries, including case cancellation.
		c, err := r.getCase(ctx, p, caseID, true)
		if err != nil {
			return err
		}
		if !p.canWrite(c) {
			return Forbidden()
		}
		if c.Status != "in_progress" {
			return Conflict("完了・中止済みの案件は編集できません。")
		}
		row, err := r.getVersion(ctx, p, caseID, recordID, id, true)
		if err != nil {
			return err
		}
		if row.Status != "draft" {
			return Conflict("提出済みの記録版は変更できません。")
		}
		if row.LockVersion != *in.LockVersion {
			return problem(409, "version_conflict", "別の更新が保存されています。最新の下書きを取得してください。")
		}
		if row.ConfigurationVersionID != c.ConfigurationVersionID {
			return Conflict("案件と下書きの構成版が一致しません。")
		}
		record, err := r.getRecord(ctx, p, caseID, recordID)
		if err != nil {
			return err
		}
		b, err := r.rules(ctx, p.TenantID, row.ConfigurationVersionID, c.CaseType)
		if err != nil {
			return err
		}
		rules, ok := b.RecordKinds[record.RecordKind]
		if !ok {
			return Conflict("構成版に記録種別がありません。")
		}
		if err := validateEntries(in.Entries, rules); err != nil {
			return err
		}
		if err := r.replaceEntries(ctx, p, row, in.Entries); err != nil {
			return err
		}
		if err := r.advanceDraft(ctx, p, id, *in.LockVersion); err != nil {
			return err
		}
		row.LockVersion++
		if err := r.audit(ctx, p, "draft.update", "record_version", id, map[string]any{"lock_version": row.LockVersion}); err != nil {
			return err
		}
		result, err = r.versionDTO(ctx, p, row)
		return err
	})
	return result, err
}
