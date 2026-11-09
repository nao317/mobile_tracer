package authn

import (
	"encoding/json"
	"github.com/labstack/echo/v5"
	"github.com/nao317/mobile_tracer/backend/internal/business"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"time"
)

type workflowShare struct {
	ID          string     `json:"id"`
	VersionID   string     `json:"version_id"`
	SenderID    string     `json:"sender_id"`
	RecipientID string     `json:"recipient_id"`
	Content     []byte     `json:"-"`
	ExpiresAt   time.Time  `json:"expires_at"`
	CreatedAt   time.Time  `json:"created_at"`
	AcceptedAt  *time.Time `json:"accepted_at"`
	RevokedAt   *time.Time `json:"revoked_at"`
}

func (s *Service) registerWorkflowSharing(g *echo.Group) {
	g.GET("/shares", func(c *echo.Context) error {
		a := c.Get("workflow.actor").(Authenticated)
		rows := []workflowShare{}
		if err := s.db.WithContext(c.Request().Context()).Table("app.workflow_shares").Where("sender_id=? OR recipient_id=?", a.User.ID, a.User.ID).Order("created_at DESC").Limit(100).Find(&rows).Error; err != nil {
			return err
		}
		result := []map[string]any{}
		for _, r := range rows {
			var content any
			if r.SenderID == a.User.ID || r.AcceptedAt != nil && r.RevokedAt == nil && time.Now().Before(r.ExpiresAt) {
				if err := json.Unmarshal(r.Content, &content); err != nil {
					return err
				}
			}
			result = append(result, map[string]any{"share": r, "content": content})
		}
		return c.JSON(200, map[string]any{"data": result})
	})
	g.POST("/shares/:shareID/:operation", func(c *echo.Context) error {
		if !business.ValidID(c.Param("shareID")) {
			return business.NotFound()
		}
		a := c.Get("workflow.actor").(Authenticated)
		err := s.db.WithContext(c.Request().Context()).Transaction(func(tx *gorm.DB) error {
			var row workflowShare
			if err := tx.Table("app.workflow_shares").Clauses(clause.Locking{Strength: "UPDATE"}).Where("id=? AND (sender_id=? OR recipient_id=?)", c.Param("shareID"), a.User.ID, a.User.ID).Take(&row).Error; err != nil {
				return err
			}
			field := ""
			switch c.Param("operation") {
			case "accept":
				if row.RecipientID != a.User.ID {
					return business.Forbidden()
				}
				if row.RevokedAt != nil || !time.Now().Before(row.ExpiresAt) {
					return business.Conflict("共有が終了しています。")
				}
				if row.AcceptedAt != nil {
					return nil
				}
				field = "accepted_at"
			case "revoke":
				if row.SenderID != a.User.ID {
					return business.Forbidden()
				}
				if row.RevokedAt != nil {
					return nil
				}
				field = "revoked_at"
			default:
				return business.NotFound()
			}
			if err := tx.Table("app.workflow_shares").Where("id=?", row.ID).Update(field, time.Now().UTC()).Error; err != nil {
				return err
			}
			return workflowAudit(c.Request().Context(), tx, a.User, "transaction.share."+c.Param("operation"), "record_version", row.VersionID, map[string]any{"share_id": row.ID})
		})
		if err != nil {
			return err
		}
		return c.JSON(200, map[string]any{"data": "saved"})
	})
	g.POST("/:versionID/share", func(c *echo.Context) error {
		a := c.Get("workflow.actor").(Authenticated)
		var in struct {
			Email     string    `json:"email"`
			ExpiresAt time.Time `json:"expires_at"`
		}
		if err := decodeJSON(c.Request(), &in); err != nil {
			return err
		}
		if !in.ExpiresAt.After(time.Now()) || in.ExpiresAt.After(time.Now().Add(365*24*time.Hour)) {
			return business.Invalid("expires_at", "共有期限を指定してください。")
		}
		err := s.db.WithContext(c.Request().Context()).Transaction(func(tx *gorm.DB) error {
			v, err := workflowVersionRow(tx, c.Param("versionID"), false)
			if err != nil {
				return err
			}
			if _, err = s.workflowAccess(c, tx, a, v); err != nil {
				return err
			}
			var recipient User
			if err = tx.Table("auth.users").Where("lower(email)=lower(?) AND status='active' AND email_verified=true", in.Email).Take(&recipient).Error; err != nil || recipient.ID == a.User.ID {
				return business.Invalid("email", "有効な共有先を指定してください。")
			}
			var anchor workflowAnchor
			var apiJob apiRegistration
			if e := tx.Table("integrity.api_registrations").Where("subject_type='record' AND subject_id=? AND status='confirmed'", v.ID).Take(&apiJob).Error; e == nil {
				anchor.Txid = apiJob.Txid
				anchor.ManifestHash = apiJob.ManifestHash
			} else if err = tx.Table("app.workflow_anchors").Where("version_id=? AND status='registered'", v.ID).Take(&anchor).Error; err != nil {
				return business.Conflict("登録済みの記録だけ共有できます。")
			}
			var row struct{ Content []byte }
			if err = tx.Table("app.workflow_presentations").Where("version_id=?", v.ID).Take(&row).Error; err != nil {
				return err
			}
			var content workflowContent
			if err = json.Unmarshal(row.Content, &content); err != nil {
				return err
			}
			// No arbitrary text entries, images, people, tenant IDs, or ownership history.
			// Only explicitly defined numeric condition values leave the source version.
			condition := map[string]any{}
			for _, key := range []string{"odometer", "fuel_level", "estimate"} {
				if raw, ok := content.Version.Entries[key]; ok {
					var number json.Number
					if json.Unmarshal(raw, &number) == nil {
						if n, e := number.Float64(); e == nil {
							condition[key] = n
						}
					}
				}
			}
			sanitized := map[string]any{"model_name": content.Vehicle.ModelName, "version_no": content.Version.VersionNo, "recorded_at": content.Version.CreatedAt, "condition": condition, "txid": anchor.Txid, "manifest_hash": anchor.ManifestHash}
			raw, err := canonical(sanitized)
			if err != nil {
				return err
			}
			var id string
			if err = tx.Raw(`INSERT INTO app.workflow_shares(version_id,sender_id,recipient_id,content,expires_at) VALUES(?,?,?,?,?) RETURNING id`, v.ID, a.User.ID, recipient.ID, raw, in.ExpiresAt).Scan(&id).Error; err != nil {
				return err
			}
			return workflowAudit(c.Request().Context(), tx, a.User, "transaction.share", "record_version", v.ID, map[string]any{"share_id": id})
		})
		if err != nil {
			return err
		}
		return c.JSON(201, map[string]any{"data": "shared"})
	})
}
