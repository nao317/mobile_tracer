package authn

import (
	"github.com/labstack/echo/v5"
	"github.com/nao317/mobile_tracer/backend/internal/business"
	"gorm.io/gorm"
	"time"
)

type workflowOwner struct {
	ID          string    `json:"id"`
	UserID      string    `json:"user_id"`
	EffectiveAt time.Time `json:"effective_at"`
	CreatedAt   time.Time `json:"created_at"`
}

func (s *Service) listWorkflowOwners(c *echo.Context) error {
	v, err := workflowVersionRow(s.db, c.Param("versionID"), false)
	if err != nil {
		return err
	}
	a := c.Get("workflow.actor").(Authenticated)
	manage, err := s.workflowAccess(c, s.db, a, v)
	if err != nil {
		return err
	}
	// Ownership alone never grants access. Customers see only their own events;
	// businesses see only events recorded in the same company.
	var caseRow struct{ VehicleID string }
	if err = s.db.Table("app.cases").Where("id=?", v.CaseID).Take(&caseRow).Error; err != nil {
		return err
	}
	q := s.db.Table("app.workflow_ownerships").Where("vehicle_id=? AND tenant_id=?", caseRow.VehicleID, v.TenantID)
	if !manage {
		q = q.Where("user_id=?", a.User.ID)
	}
	rows := []workflowOwner{}
	if err = q.Order("effective_at,created_at,id").Find(&rows).Error; err != nil {
		return err
	}
	return c.JSON(200, map[string]any{"data": rows})
}
func (s *Service) addWorkflowOwner(c *echo.Context) error {
	a := c.Get("workflow.actor").(Authenticated)
	var in struct {
		UserID      string    `json:"user_id"`
		EffectiveAt time.Time `json:"effective_at"`
	}
	if err := decodeJSON(c.Request(), &in); err != nil {
		return err
	}
	if !business.ValidID(in.UserID) || in.EffectiveAt.IsZero() {
		return business.Invalid("user_id", "所有者と有効日時を指定してください。")
	}
	err := s.db.WithContext(c.Request().Context()).Transaction(func(tx *gorm.DB) error {
		v, err := workflowVersionRow(tx, c.Param("versionID"), true)
		if err != nil {
			return err
		}
		p, err := s.workflowStaff(c, tx, v)
		if err != nil {
			return err
		}
		item, err := business.New(tx).Case(c.Request().Context(), p, v.CaseID)
		if err != nil {
			return err
		}
		allowed := false
		for _, r := range p.Roles {
			if (r.Role == "tenant_admin" || r.Role == "store_manager") && (r.StoreID == nil || *r.StoreID == item.StoreID) {
				allowed = true
			}
		}
		if !allowed {
			return business.Forbidden()
		}
		var q workflowRequest
		if err = tx.Table("app.workflow_requests q").Select("q.*").Joins("JOIN app.workflow_responses r ON r.request_id=q.id AND r.actor_id=q.user_id AND r.decision='approved'").Where("q.version_id=? AND q.user_id=? AND q.qualification='owner' AND q.kind='state_agreement' AND r.created_at<=q.deadline", v.ID, in.UserID).Take(&q).Error; err != nil {
			return business.Conflict("所有者本人の状態同意が必要です。")
		}
		var id string
		if err = tx.Raw(`INSERT INTO app.workflow_ownerships(tenant_id,case_id,vehicle_id,user_id,actor_id,effective_at) VALUES(?,?,?,?,?,?) RETURNING id`, v.TenantID, v.CaseID, item.VehicleID, in.UserID, a.User.ID, in.EffectiveAt).Scan(&id).Error; err != nil {
			return err
		}
		return workflowAudit(c.Request().Context(), tx, a.User, "transaction.ownership", "vehicle", item.VehicleID, map[string]any{"ownership_id": id, "user_id": in.UserID})
	})
	if err != nil {
		return err
	}
	return c.JSON(201, map[string]any{"data": "created"})
}
