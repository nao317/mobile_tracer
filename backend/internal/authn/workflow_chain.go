package authn

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/labstack/echo/v5"
	"github.com/nao317/mobile_tracer/backend/internal/business"
	"github.com/nao317/mobile_tracer/backend/internal/tapyrus"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type WorkflowChain interface {
	Prepare(context.Context, string) (string, string, error)
	Broadcast(context.Context, string) error
	Anchored(context.Context, string, string) (bool, error)
}

// StartWorkflow resumes the durable queue after process restarts. A PostgreSQL
// advisory lock serializes wallet funding across all API instances.
func (s *Service) StartWorkflow(ctx context.Context, chain WorkflowChain) {
	s.workflowChain = chain
	go func() {
		if ctx.Err() != nil {
			return
		}
		ticker := time.NewTicker(10 * time.Second)
		defer ticker.Stop()
		for {
			if err := s.ProcessWorkflowQueue(ctx); err != nil && !errors.Is(err, context.Canceled) {
				s.logger.Warn("anchor queue processing failed")
			}
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
}

// ProcessWorkflowQueue runs one durable queue item. It is also used by integration checks.
func (s *Service) ProcessWorkflowQueue(ctx context.Context) error {
	if s.workflowChain == nil {
		return nil
	}
	// A short transaction prepares and durably stores a transaction before send.
	var pending workflowAnchor
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var locked bool
		if err := tx.Raw("SELECT pg_try_advisory_xact_lock(748312901)").Scan(&locked).Error; err != nil {
			return err
		}
		if !locked {
			return nil
		}
		err := tx.Table("app.workflow_anchors").Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"}).Where("status <> 'registered' AND updated_at < now() - interval '5 seconds'").Order("updated_at").Take(&pending).Error
		if err == gorm.ErrRecordNotFound {
			return nil
		}
		if err != nil {
			return err
		}
		qs, err := workflowRequests(tx, pending.VersionID)
		if err != nil {
			return err
		}
		if !workflowApproved(qs) {
			return business.Conflict("顧客承認が不足しています。")
		}
		selectedID := pending.VersionID
		updates := map[string]any{"attempts": gorm.Expr("attempts+1"), "updated_at": time.Now().UTC(), "status": "sending"}
		if pending.RawTx == nil {
			raw, id, e := s.workflowChain.Prepare(ctx, pending.ManifestHash)
			if e != nil {
				updates["status"] = "failed"
				pending.VersionID = ""
			} else {
				pending.RawTx = &raw
				pending.Txid = &id
				updates["raw_tx"] = raw
				updates["txid"] = id
			}
		}
		if err := tx.Table("app.workflow_anchors").Where("version_id=?", selectedID).Updates(updates).Error; err != nil {
			return err
		}
		return workflowSystemAudit(ctx, tx, selectedID, updates["status"].(string))
	})
	if err != nil || pending.VersionID == "" || pending.RawTx == nil {
		return err
	}
	// Every retry sends the SAME signed transaction. Two workers broadcasting it
	// after lease expiration cannot create two independent records.
	confirmed, checkErr := s.workflowChain.Anchored(ctx, *pending.Txid, pending.ManifestHash)
	status := "unknown"
	if confirmed {
		status = "registered"
	} else {
		broadcastErr := s.workflowChain.Broadcast(ctx, *pending.RawTx)
		confirmed, checkErr = s.workflowChain.Anchored(ctx, *pending.Txid, pending.ManifestHash)
		if confirmed {
			status = "registered"
		} else if checkErr == nil && broadcastErr == nil {
			status = "sending"
		}
	}
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var current workflowAnchor
		if err := tx.Table("app.workflow_anchors").Clauses(clause.Locking{Strength: "UPDATE"}).Where("version_id=?", pending.VersionID).Take(&current).Error; err != nil {
			return err
		}
		if current.Status == "registered" {
			return nil
		}
		updates := map[string]any{"status": status, "updated_at": time.Now().UTC()}
		if status == "registered" {
			updates["registered_at"] = time.Now().UTC()
		}
		if err := tx.Table("app.workflow_anchors").Where("version_id=?", pending.VersionID).Updates(updates).Error; err != nil {
			return err
		}
		return workflowSystemAudit(ctx, tx, pending.VersionID, status)
	})
}
func (s *Service) verifyWorkflow(c *echo.Context) error {
	a := c.Get("workflow.actor").(Authenticated)
	db := s.db.WithContext(c.Request().Context())
	v, err := workflowVersionRow(db, c.Param("versionID"), false)
	if err != nil {
		return err
	}
	if _, err = s.workflowAccess(c, db, a, v); err != nil {
		return err
	}
	result := "unverifiable"
	var apiJob apiRegistration
	if e := db.Table("integrity.api_registrations").Where("subject_type='record' AND subject_id=?", v.ID).Take(&apiJob).Error; e == nil && s.timestampAPI != nil {
		result, err = s.verifyTimestamp(c.Request().Context(), apiJob)
		if err != nil {
			return err
		}
		match, missing, e := recordMaterial(db, v, apiJob.Manifest)
		if e != nil {
			return e
		}
		if missing {
			result = "unverifiable"
		} else if result == "match" && !match {
			result = "mismatch"
		}
	} else {
		var anchor workflowAnchor
		if e := db.Table("app.workflow_anchors").Where("version_id=? AND status='registered'", v.ID).Take(&anchor).Error; e == nil && anchor.Txid != nil && s.workflowChain != nil {
			match, missing, e := recordMaterial(db, v, anchor.Manifest)
			if e != nil {
				return e
			}
			ok, e := s.workflowChain.Anchored(c.Request().Context(), *anchor.Txid, anchor.ManifestHash)
			if !missing {
				if errors.Is(e, tapyrus.ErrAnchorMismatch) {
					result = "mismatch"
				} else if e == nil && ok {
					if match && digest(string(anchor.Manifest)) == anchor.ManifestHash {
						result = "match"
					} else {
						result = "mismatch"
					}
				}
			}
		}
	}
	if err = s.db.Transaction(func(tx *gorm.DB) error {
		return workflowAudit(c.Request().Context(), tx, a.User, "transaction.verify", "record_version", v.ID, map[string]any{"result": result})
	}); err != nil {
		return err
	}
	return c.JSON(200, map[string]any{"data": map[string]string{"result": result}})
}
func recordMaterial(db *gorm.DB, v workflowVersion, manifest []byte) (bool, bool, error) {
	var stored struct {
		Content     []byte
		ContentHash string
	}
	if e := db.Table("app.workflow_presentations").Where("version_id=?", v.ID).Take(&stored).Error; e != nil {
		return false, false, e
	}
	var content workflowContent
	if e := json.Unmarshal(stored.Content, &content); e != nil {
		return false, false, e
	}
	match := digest(string(stored.Content)) == stored.ContentHash
	entries := []struct {
		ItemKey string
		Value   json.RawMessage
	}{}
	if e := db.Table("app.record_entries").Where("record_version_id=?", v.ID).Find(&entries).Error; e != nil {
		return false, false, e
	}
	actual := map[string]json.RawMessage{}
	for _, entry := range entries {
		actual[entry.ItemKey] = entry.Value
	}
	left, e := canonical(actual)
	if e != nil {
		return false, false, e
	}
	right, e := canonical(content.Version.Entries)
	if e != nil {
		return false, false, e
	}
	match = match && bytes.Equal(left, right)
	missing := false
	for _, m := range content.Media {
		var row struct{ Bytes []byte }
		e := db.Table("app.workflow_media").Where("id=? AND record_version_id=?", m.ID, v.ID).Take(&row).Error
		if e == gorm.ErrRecordNotFound {
			missing = true
			continue
		}
		if e != nil {
			return false, false, e
		}
		if len(row.Bytes) == 0 {
			missing = true
		}
		match = match && digest(string(row.Bytes)) == m.SHA256
	}
	qs, e := workflowRequests(db, v.ID)
	if e != nil {
		return false, false, e
	}
	expected, e := canonical(struct {
		Schema      string            `json:"schema"`
		ContentHash string            `json:"content_hash"`
		Approvals   []workflowRequest `json:"approvals"`
	}{"mobile-tracer/anchor/v1", digest(string(stored.Content)), qs})
	return match && bytes.Equal(expected, manifest), missing, e
}

func workflowSystemAudit(ctx context.Context, tx *gorm.DB, id, status string, kinds ...string) error {
	kind := "record_version"
	if len(kinds) > 0 {
		kind = kinds[0]
	}
	at := time.Now().UTC()
	return tx.WithContext(ctx).Table("audit.events").Create(map[string]any{"actor_type": "system", "action": "transaction.anchor." + status, "target_type": kind, "target_id": id, "result": "succeeded", "created_at": at, "details": "{}", "entry_hash": digest(id + status + at.Format(time.RFC3339Nano))}).Error
}
