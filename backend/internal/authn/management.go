package authn

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/nao317/mobile_tracer/backend/internal/business"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func managedUser(db *gorm.DB, id string) (ManagedUser, error) {
	var user ManagedUser
	err := db.Table("auth.users").Where("id=?", id).Take(&user).Error
	return user, err
}
func lockUser(db *gorm.DB, id string) (ManagedUser, error) {
	var user ManagedUser
	err := db.Table("auth.users").Clauses(clause.Locking{Strength: "UPDATE"}).Where("id=?", id).Take(&user).Error
	return user, err
}
func companyQuery(db *gorm.DB) *gorm.DB {
	return db.Table("app.tenants t").Joins("LEFT JOIN app.company_profiles p ON p.company_id=t.id").Select("t.id,t.name,t.status,t.created_at,COALESCE(p.version,0) AS version,COALESCE(p.profile,'{}'::jsonb) AS profile")
}
func decodeCompany(company *Company) error {
	if err := json.Unmarshal(company.RawProfile, &company.Profile); err != nil {
		return err
	}
	if company.Profile.BusinessTypes == nil {
		company.Profile.BusinessTypes = []string{}
	}
	return nil
}
func getCompany(db *gorm.DB, id string) (Company, error) {
	var company Company
	err := companyQuery(db).Where("t.id=?", id).Take(&company).Error
	if err == nil {
		err = decodeCompany(&company)
	}
	return company, err
}
func lockCompany(db *gorm.DB, id string) error {
	var row struct{ ID string }
	return db.Table("app.tenants").Clauses(clause.Locking{Strength: "UPDATE"}).Where("id=?", id).Take(&row).Error
}
func ownCompanies(db *gorm.DB, userID string) ([]Company, error) {
	companies := []Company{}
	err := companyQuery(db).Where(`EXISTS (SELECT 1 FROM auth.staff_links l JOIN app.staff_members st ON st.id=l.staff_id AND st.tenant_id=l.tenant_id WHERE l.tenant_id=t.id AND l.user_id=? AND l.revoked_at IS NULL AND st.status='active')`, userID).Order("t.name,t.id").Find(&companies).Error
	if err != nil {
		return nil, err
	}
	for i := range companies {
		if err := decodeCompany(&companies[i]); err != nil {
			return nil, err
		}
	}
	return companies, nil
}
func hasCompany(db *gorm.DB, userID, companyID string) error {
	var count int64
	err := db.Table("auth.staff_links l").Joins("JOIN app.staff_members st ON st.id=l.staff_id AND st.tenant_id=l.tenant_id").Joins("JOIN app.tenants t ON t.id=l.tenant_id").Where("l.user_id=? AND l.tenant_id=? AND l.revoked_at IS NULL AND st.status='active' AND t.status='active'", userID, companyID).Count(&count).Error
	if err != nil {
		return err
	}
	if count == 0 {
		return business.Forbidden()
	}
	return nil
}

func managementAudit(ctx context.Context, tx *gorm.DB, actor User, action, targetType, targetID string, details any) error {
	encoded, err := json.Marshal(details)
	if err != nil {
		return err
	}
	actingAs := "system_admin"
	if action == "management.request_created" {
		actingAs = "applicant"
	}
	return tx.WithContext(ctx).Table("audit.events").Create(map[string]any{"actor_type": "user", "actor_id": actor.ID, "acting_as": actingAs, "action": action, "target_type": targetType, "target_id": targetID, "result": "succeeded", "details": string(encoded), "entry_hash": digest(actor.ID + action + targetID + string(encoded) + time.Now().UTC().Format(time.RFC3339Nano))}).Error
}
func providerOperator(tx *gorm.DB, actor User) (string, error) {
	if err := tx.Table("app.provider_operators").Clauses(clause.OnConflict{DoNothing: true}).Create(map[string]any{"display_name": actor.DisplayName, "email": strings.ToLower(actor.Email), "role": "admin"}).Error; err != nil {
		return "", err
	}
	var row struct {
		ID         string
		DisabledAt *time.Time
	}
	if err := tx.Table("app.provider_operators").Where("email=?", strings.ToLower(actor.Email)).Take(&row).Error; err != nil {
		return "", err
	}
	if row.DisabledAt != nil {
		return "", business.Forbidden()
	}
	return row.ID, nil
}
func addCompanyMember(tx *gorm.DB, actor User, companyID string, user ManagedUser, role string) error {
	if user.Status != "active" || user.AccountType != "business" {
		return business.Conflict("有効な業者ユーザーを選択してください。")
	}
	if role != "tenant_admin" && role != "staff" && role != "auditor" {
		return business.Invalid("role", "企業内の役割を選択してください。")
	}
	var existing int64
	if err := tx.Table("auth.staff_links").Where("tenant_id=? AND user_id=? AND revoked_at IS NULL", companyID, user.ID).Count(&existing).Error; err != nil {
		return err
	}
	if existing > 0 {
		return business.Conflict("すでにこの企業に所属しています。")
	}
	operator, err := providerOperator(tx, actor)
	if err != nil {
		return err
	}
	staffID := newUUID()
	name := user.DisplayName
	if name == "" {
		name = user.Email
	}
	// Reuse only an explicit historical link for this user, never an email match.
	var previous struct{ StaffID string }
	err = tx.Table("auth.staff_links").Where("user_id=? AND tenant_id=?", user.ID, companyID).Order("created_at DESC,id DESC").Take(&previous).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	if err == nil {
		staffID = previous.StaffID
		var roles []string
		if err := tx.Table("app.staff_role_assignments").Where("tenant_id=? AND staff_id=? AND revoked_at IS NULL", companyID, staffID).Pluck("role", &roles).Error; err != nil {
			return err
		}
		if len(roles) != 1 || roles[0] != role {
			return business.Conflict("以前の所属と同じ役割で再追加してください。")
		}
		if err := tx.Table("app.staff_members").Where("id=? AND tenant_id=?", staffID, companyID).Updates(map[string]any{"display_name": name, "email": user.Email, "status": "active"}).Error; err != nil {
			return err
		}
	} else {
		if err := tx.Table("app.staff_members").Create(map[string]any{"id": staffID, "tenant_id": companyID, "display_name": name, "email": user.Email, "status": "active"}).Error; err != nil {
			return err
		}
		if err := tx.Table("app.staff_role_assignments").Create(map[string]any{"tenant_id": companyID, "staff_id": staffID, "role": role, "created_by_operator": operator}).Error; err != nil {
			return err
		}
	}
	return tx.Table("auth.staff_links").Create(map[string]any{"user_id": user.ID, "tenant_id": companyID, "staff_id": staffID}).Error
}
func initialConfiguration(tx *gorm.DB, actor User, companyID string, types []string) error {
	operator, err := providerOperator(tx, actor)
	if err != nil {
		return err
	}
	var staff struct{ StaffID string }
	if err := tx.Table("auth.staff_links").Where("tenant_id=? AND revoked_at IS NULL", companyID).Take(&staff).Error; err != nil {
		return err
	}
	businesses := map[string]any{}
	templates := map[string]string{}
	for _, kind := range types {
		rules := map[string]any{"stages": []string{"intake", "inspection"}, "transitions": map[string][]string{"intake": {"inspection"}}, "record_kinds": map[string]any{"inspection": map[string]any{"fields": map[string]any{"odometer": map[string]any{"type": "integer", "minimum": 0, "maximum": 1000000000, "required": true}, "notes": map[string]any{"type": "string", "max_length": 2000, "nullable": true}}}}}
		encoded, _ := json.Marshal(rules)
		if err := tx.Table("app.business_templates").Clauses(clause.OnConflict{DoNothing: true}).Create(map[string]any{"business_type": kind, "version_no": 1, "definition": string(encoded)}).Error; err != nil {
			return err
		}
		var template struct{ ID string }
		if err := tx.Table("app.business_templates").Where("business_type=?", kind).Order("version_no DESC").Take(&template).Error; err != nil {
			return err
		}
		templates[kind] = template.ID
		businesses[kind] = rules
	}
	settings, _ := json.Marshal(map[string]any{"schema_version": 1, "businesses": businesses})
	id := newUUID()
	if err := tx.Table("app.configuration_versions").Create(map[string]any{"id": id, "tenant_id": companyID, "version_no": 1, "status": "draft", "settings": string(settings), "created_by_operator": operator}).Error; err != nil {
		return err
	}
	for kind, template := range templates {
		if err := tx.Table("app.configuration_modules").Create(map[string]any{"tenant_id": companyID, "configuration_version_id": id, "business_type": kind, "template_id": template}).Error; err != nil {
			return err
		}
	}
	return tx.Table("app.configuration_versions").Where("id=?", id).Updates(map[string]any{"status": "published", "published_by": staff.StaffID, "published_at": time.Now().UTC()}).Error
}
func createCompany(tx *gorm.DB, actor User, owner ManagedUser, input CompanyInput) (string, error) {
	if err := validateCompany(input, false); err != nil {
		return "", err
	}
	id := newUUID()
	if err := tx.Table("app.tenants").Create(map[string]any{"id": id, "name": input.Name, "status": "active"}).Error; err != nil {
		return "", err
	}
	profile, _ := json.Marshal(input.Profile)
	if err := tx.Table("app.company_profiles").Create(map[string]any{"company_id": id, "profile": string(profile)}).Error; err != nil {
		return "", err
	}
	if err := tx.Table("app.stores").Create(map[string]any{"tenant_id": id, "name": "本店"}).Error; err != nil {
		return "", err
	}
	if err := addCompanyMember(tx, actor, id, owner, "tenant_admin"); err != nil {
		return "", err
	}
	if err := initialConfiguration(tx, actor, id, input.Profile.BusinessTypes); err != nil {
		return "", err
	}
	return id, nil
}
func saveCompany(tx *gorm.DB, id string, input CompanyInput, status string) error {
	if err := validateCompany(input, true); err != nil {
		return err
	}
	if err := lockCompany(tx, id); err != nil {
		return err
	}
	current, err := getCompany(tx, id)
	if err != nil {
		return err
	}
	if current.Version != *input.Version {
		return business.Conflict("企業情報が更新されています。最新の内容との差分を確認してください。")
	}
	if err := tx.Table("app.tenants").Where("id=?", id).Updates(map[string]any{"name": input.Name, "status": status}).Error; err != nil {
		return err
	}
	profile, _ := json.Marshal(input.Profile)
	return tx.Table("app.company_profiles").Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "company_id"}}, DoUpdates: clause.Assignments(map[string]any{"profile": string(profile), "version": current.Version + 1, "updated_at": time.Now().UTC()})}).Create(map[string]any{"company_id": id, "profile": string(profile), "version": current.Version + 1}).Error
}
func (s *Service) createRequest(ctx context.Context, actor User, input CreateRequestInput) (ManagementRequest, error) {
	payload, err := requestPayload(input)
	if err != nil {
		return ManagementRequest{}, err
	}
	var request ManagementRequest
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		user, err := lockUser(tx, actor.ID)
		if err != nil {
			return err
		}
		if user.Status != "active" {
			return business.Forbidden()
		}
		err = tx.Table("auth.management_requests").Where("requester_id=? AND request_key=?", actor.ID, input.RequestKey).Take(&request).Error
		if err == nil {
			var stored, submitted any
			_ = json.Unmarshal(request.Payload, &stored)
			_ = json.Unmarshal(payload, &submitted)
			a, _ := json.Marshal(stored)
			b, _ := json.Marshal(submitted)
			sameCompany := request.CompanyID == nil && input.CompanyID == nil || request.CompanyID != nil && input.CompanyID != nil && *request.CompanyID == *input.CompanyID
			if request.Kind != input.Kind || !sameCompany && request.Kind != "company_create" || string(a) != string(b) {
				return business.Conflict("同じ申請キーで内容を変更できません。")
			}
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if input.Kind == "business_upgrade" {
			if user.AccountType != "general" {
				return business.Conflict("すでに業者ユーザーです。")
			}
		} else {
			if user.AccountType != "business" {
				return business.Forbidden()
			}
			if input.CompanyID != nil {
				if err := hasCompany(tx, actor.ID, *input.CompanyID); err != nil {
					return err
				}
			}
		}
		request = ManagementRequest{ID: newUUID(), RequesterID: actor.ID, RequestKey: input.RequestKey, Kind: input.Kind, CompanyID: input.CompanyID, Payload: payload, Status: "pending", CreatedAt: time.Now().UTC()}
		if err := tx.Table("auth.management_requests").Omit("requester_email").Create(map[string]any{"id": request.ID, "requester_id": request.RequesterID, "request_key": request.RequestKey, "kind": request.Kind, "company_id": request.CompanyID, "payload": string(payload), "status": "pending", "created_at": request.CreatedAt}).Error; err != nil {
			return err
		}
		return managementAudit(ctx, tx, actor, "management.request_created", "management_request", request.ID, map[string]any{"kind": input.Kind})
	})
	return request, err
}
func (s *Service) decideRequest(ctx context.Context, actor User, id, decision, reason string) (ManagementRequest, error) {
	if !business.ValidID(id) {
		return ManagementRequest{}, business.Invalid("id", "申請を確認してください。")
	}
	if decision != "approved" && decision != "rejected" {
		return ManagementRequest{}, business.Invalid("decision", "承認または拒否を選択してください。")
	}
	if err := validText("reason", reason, 2000, true); err != nil {
		return ManagementRequest{}, err
	}
	var request ManagementRequest
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Table("auth.management_requests").Clauses(clause.Locking{Strength: "UPDATE"}).Where("id=?", id).Take(&request).Error; err != nil {
			return err
		}
		if request.Status != "pending" {
			if request.Status == decision {
				return nil
			}
			return business.Conflict("この申請は審査済みです。")
		}
		if decision == "approved" {
			user, err := lockUser(tx, request.RequesterID)
			if err != nil {
				return err
			}
			if user.Status != "active" {
				return business.Conflict("停止中の申請者の申請は承認できません。")
			}
			switch request.Kind {
			case "business_upgrade":
				if user.AccountType != "general" {
					return business.Conflict("ユーザー区分が変更されています。")
				}
				var input UpgradeInput
				if err := json.Unmarshal(request.Payload, &input); err != nil {
					return err
				}
				if err := tx.Table("auth.users").Where("id=?", user.ID).Updates(map[string]any{"account_type": "business", "display_name": input.DisplayName, "version": gorm.Expr("version + 1")}).Error; err != nil {
					return err
				}
			case "company_create":
				if user.AccountType != "business" {
					return business.Forbidden()
				}
				var input CompanyInput
				if err := json.Unmarshal(request.Payload, &input); err != nil {
					return err
				}
				companyID, err := createCompany(tx, actor, user, input)
				if err != nil {
					return err
				}
				request.CompanyID = &companyID
			case "company_profile_update":
				if user.AccountType != "business" || request.CompanyID == nil {
					return business.Forbidden()
				}
				if err := hasCompany(tx, user.ID, *request.CompanyID); err != nil {
					return err
				}
				var input CompanyInput
				if err := json.Unmarshal(request.Payload, &input); err != nil {
					return err
				}
				if err := lockCompany(tx, *request.CompanyID); err != nil {
					return err
				}
				current, err := getCompany(tx, *request.CompanyID)
				if err != nil {
					return err
				}
				if err := saveCompany(tx, *request.CompanyID, input, current.Status); err != nil {
					return err
				}
			default:
				return business.Invalid("kind", "対応していない申請です。")
			}
		}
		now := time.Now().UTC()
		updates := map[string]any{"company_id": request.CompanyID, "status": decision, "decided_by": actor.ID, "decided_at": now, "decision_reason": reason}
		if err := tx.Table("auth.management_requests").Where("id=? AND status='pending'", id).Updates(updates).Error; err != nil {
			return err
		}
		request.Status = decision
		request.DecidedBy = &actor.ID
		request.DecidedAt = &now
		request.DecisionReason = reason
		return managementAudit(ctx, tx, actor, "management.request_"+decision, "management_request", id, map[string]any{"kind": request.Kind, "reason": reason, "company_id": request.CompanyID})
	})
	return request, err
}
func (s *Service) updateManagedUser(ctx context.Context, actor User, id string, input ManagedUser) error {
	if !business.ValidID(id) {
		return business.Invalid("id", "ユーザーを確認してください。")
	}
	if input.AccountType != "general" && input.AccountType != "business" {
		return business.Invalid("account_type", "ユーザー区分を確認してください。")
	}
	if input.Status != "active" && input.Status != "suspended" {
		return business.Invalid("status", "有効・停止を選択してください。")
	}
	if err := validText("display_name", input.DisplayName, 200, false); err != nil {
		return err
	}
	if actor.ID == id && input.Status == "suspended" {
		return business.Conflict("自分自身の管理者アカウントは停止できません。")
	}
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		user, err := lockUser(tx, id)
		if err != nil {
			return err
		}
		if user.Version != input.Version {
			return business.Conflict("ユーザーが更新されています。最新の内容を確認してください。")
		}
		if err := tx.Table("auth.users").Where("id=?", id).Updates(map[string]any{"display_name": input.DisplayName, "account_type": input.AccountType, "status": input.Status, "version": user.Version + 1}).Error; err != nil {
			return err
		}
		if input.AccountType == "general" && user.AccountType != "general" {
			if err := tx.Table("auth.staff_links").Where("user_id=? AND revoked_at IS NULL", id).Update("revoked_at", time.Now().UTC()).Error; err != nil {
				return err
			}
			if err := tx.Table("auth.sessions").Where("user_id=? AND revoked_at IS NULL", id).Update("selected_staff_id", nil).Error; err != nil {
				return err
			}
		}
		if input.Status == "suspended" {
			if err := tx.Table("auth.sessions").Where("user_id=? AND revoked_at IS NULL", id).Update("revoked_at", time.Now().UTC()).Error; err != nil {
				return err
			}
		}
		return managementAudit(ctx, tx, actor, "management.user_updated", "auth_user", id, map[string]any{"from_type": user.AccountType, "to_type": input.AccountType, "from_status": user.Status, "to_status": input.Status})
	})
}
func companyMembers(db *gorm.DB, id string) ([]CompanyMember, error) {
	items := []CompanyMember{}
	err := db.Table("auth.staff_links l").Select("l.id,l.user_id,l.staff_id,s.display_name,u.email,r.role,l.revoked_at").Joins("JOIN auth.users u ON u.id=l.user_id").Joins("JOIN app.staff_members s ON s.id=l.staff_id AND s.tenant_id=l.tenant_id").Joins("JOIN app.staff_role_assignments r ON r.staff_id=s.id AND r.tenant_id=s.tenant_id AND r.revoked_at IS NULL").Where("l.tenant_id=?", id).Order("s.display_name,l.id,r.role").Find(&items).Error
	return items, err
}
func (s *Service) revokeMember(ctx context.Context, actor User, companyID, linkID, reason string) error {
	if err := validText("reason", reason, 2000, true); err != nil {
		return err
	}
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var link struct {
			UserID, StaffID string
			RevokedAt       *time.Time
		}
		if err := tx.Table("auth.staff_links").Where("id=? AND tenant_id=?", linkID, companyID).Take(&link).Error; err != nil {
			return err
		}
		if _, err := lockUser(tx, link.UserID); err != nil {
			return err
		}
		if err := lockCompany(tx, companyID); err != nil {
			return err
		}
		if link.RevokedAt != nil {
			return nil
		}
		var admins int64
		if err := tx.Table("auth.staff_links l").Joins("JOIN auth.users u ON u.id=l.user_id AND u.status='active' AND u.account_type='business'").Joins("JOIN app.staff_role_assignments r ON r.staff_id=l.staff_id AND r.tenant_id=l.tenant_id AND r.role='tenant_admin' AND r.revoked_at IS NULL").Where("l.tenant_id=? AND l.revoked_at IS NULL", companyID).Count(&admins).Error; err != nil {
			return err
		}
		var roleCount int64
		if err := tx.Table("app.staff_role_assignments").Where("staff_id=? AND tenant_id=? AND role='tenant_admin' AND revoked_at IS NULL", link.StaffID, companyID).Count(&roleCount).Error; err != nil {
			return err
		}
		if roleCount > 0 && admins <= 1 {
			return business.Conflict("最後の企業管理者の所属は解除できません。別の管理者を追加してください。")
		}
		if err := tx.Table("auth.staff_links").Where("id=? AND revoked_at IS NULL", linkID).Update("revoked_at", time.Now().UTC()).Error; err != nil {
			return err
		}
		if err := tx.Table("auth.sessions").Where("user_id=? AND selected_staff_id=? AND revoked_at IS NULL", link.UserID, link.StaffID).Update("selected_staff_id", nil).Error; err != nil {
			return err
		}
		return managementAudit(ctx, tx, actor, "management.membership_revoked", "auth_user", link.UserID, map[string]any{"company_id": companyID, "reason": reason})
	})
}

func requestSearch(db *gorm.DB, requesterID string) *gorm.DB {
	query := db.Table("auth.management_requests r").Joins("JOIN auth.users u ON u.id=r.requester_id").Joins("LEFT JOIN auth.users reviewer ON reviewer.id=r.decided_by").Select("r.*,u.email AS requester_email,COALESCE(reviewer.email,'') AS decider_email")
	if requesterID != "" {
		query = query.Where("r.requester_id=?", requesterID)
	}
	return query
}
