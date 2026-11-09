package authn

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/labstack/echo/v5"
	"github.com/nao317/mobile_tracer/backend/internal/business"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func decodeCanonical(raw []byte) (any, error) {
	var v any
	d := json.NewDecoder(bytes.NewReader(raw))
	d.UseNumber()
	err := d.Decode(&v)
	return v, err
}
func (s *Service) uploadWorkflowMedia(c *echo.Context) error {
	a := c.Get("workflow.actor").(Authenticated)
	file, err := c.FormFile("photo")
	if err != nil || file.Size <= 0 || file.Size > 10<<20 {
		return business.Invalid("photo", "10MB以内のJPEG・PNG・WebP画像を指定してください。")
	}
	input, err := file.Open()
	if err != nil {
		return err
	}
	defer input.Close()
	data, err := io.ReadAll(io.LimitReader(input, (10<<20)+1))
	if err != nil {
		return err
	}
	if len(data) > 10<<20 {
		return business.Invalid("photo", "画像の上限は10MBです。")
	}
	mime := http.DetectContentType(data)
	if mime != "image/jpeg" && mime != "image/png" && mime != "image/webp" {
		return business.Invalid("photo", "画像形式を確認してください。")
	}
	key, position := c.FormValue("request_key"), c.FormValue("position")
	if !business.ValidID(key) || len(position) == 0 || len(position) > 100 {
		return business.Invalid("position", "撮影箇所と再送キーを指定してください。")
	}
	var captured *time.Time
	if raw := c.FormValue("device_captured_at"); raw != "" {
		v, e := time.Parse(time.RFC3339, raw)
		if e != nil {
			return business.Invalid("device_captured_at", "日時を確認してください。")
		}
		captured = &v
	}
	var latitude, longitude *float64
	if c.FormValue("latitude") != "" || c.FormValue("longitude") != "" {
		lat, e1 := strconv.ParseFloat(c.FormValue("latitude"), 64)
		lon, e2 := strconv.ParseFloat(c.FormValue("longitude"), 64)
		if e1 != nil || e2 != nil || !(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
			return business.Invalid("latitude", "緯度・経度を確認してください。")
		}
		latitude = &lat
		longitude = &lon
	}
	var id string
	err = s.db.WithContext(c.Request().Context()).Transaction(func(tx *gorm.DB) error {
		v, err := workflowVersionRow(tx, c.Param("versionID"), false)
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
		if !workflowWriteAllowed(p, item) {
			return business.Forbidden()
		}
		var locked struct{ ID string }
		if err = tx.Table("app.cases").Clauses(clause.Locking{Strength: "UPDATE"}).Where("id=?", v.CaseID).Take(&locked).Error; err != nil {
			return err
		}
		v, err = workflowVersionRow(tx, v.ID, true)
		if err != nil {
			return err
		}
		var old struct{ ID, RecordVersionID, Position, SHA256 string }
		err = tx.Table("app.workflow_media").Where("tenant_id=? AND request_key=?", v.TenantID, key).Take(&old).Error
		if err == nil {
			if old.RecordVersionID != v.ID || old.Position != position || old.SHA256 != digest(string(data)) {
				return business.Conflict("再送キーが別の画像に使用されています。")
			}
			id = old.ID
			return nil
		}
		if err != gorm.ErrRecordNotFound {
			return err
		}
		if v.Status != "draft" || item.Status != "in_progress" {
			return business.Conflict("進行中の下書きにだけ画像を追加できます。")
		}
		err = tx.Raw(`INSERT INTO app.workflow_media(tenant_id,case_id,record_version_id,request_key,position,mime_type,bytes,sha256,actor_id,device_captured_at,latitude,longitude) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`, v.TenantID, v.CaseID, v.ID, key, position, mime, data, digest(string(data)), a.User.ID, captured, latitude, longitude).Scan(&id).Error
		if err != nil {
			return err
		}
		return workflowAudit(c.Request().Context(), tx, a.User, "transaction.photo", "record_version", v.ID, map[string]any{"media_id": id, "sha256": digest(string(data))})
	})
	if err != nil {
		return err
	}
	return c.JSON(201, map[string]any{"data": map[string]string{"id": id}})
}
func (s *Service) readWorkflowMedia(c *echo.Context) error {
	if !business.ValidID(c.Param("mediaID")) {
		return business.NotFound()
	}
	v, err := workflowVersionRow(s.db, c.Param("versionID"), false)
	if err != nil {
		return err
	}
	if _, err = s.workflowAccess(c, s.db, c.Get("workflow.actor").(Authenticated), v); err != nil {
		return err
	}
	var m struct {
		Bytes    []byte
		MimeType string
	}
	if err = s.db.Table("app.workflow_media").Where("id=? AND record_version_id=?", c.Param("mediaID"), v.ID).Take(&m).Error; err != nil {
		return err
	}
	c.Response().Header().Set("Content-Disposition", "inline")
	return c.Blob(200, m.MimeType, m.Bytes)
}
