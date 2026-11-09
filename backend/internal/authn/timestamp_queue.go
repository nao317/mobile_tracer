package authn

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/nao317/mobile_tracer/backend/internal/tapyrusapi"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type TimestampAPI interface {
	Create(context.Context, string) (tapyrusapi.Timestamp, error)
	Get(context.Context, int64) (tapyrusapi.Timestamp, error)
	Find(context.Context, string) (*tapyrusapi.Timestamp, error)
}
type apiRegistration struct {
	ID            string     `json:"id"`
	SubjectType   string     `json:"subject_type"`
	SubjectID     string     `json:"subject_id"`
	Manifest      []byte     `json:"-"`
	ManifestHash  string     `json:"manifest_hash"`
	Status        string     `json:"status"`
	TimestampID   *int64     `json:"timestamp_id"`
	Txid          *string    `json:"txid"`
	Attempts      int        `json:"attempts"`
	ProviderScope *string    `json:"-"`
	UpdatedAt     time.Time  `json:"updated_at"`
	ConfirmedAt   *time.Time `json:"confirmed_at"`
}

func queueTimestamp(tx *gorm.DB, kind, id string, manifest any) error {
	raw, e := canonical(manifest)
	if e != nil {
		return e
	}
	return tx.Exec(`INSERT INTO integrity.api_registrations(subject_type,subject_id,manifest,manifest_hash) VALUES(?,?,?,?) ON CONFLICT(subject_type,subject_id) DO NOTHING`, kind, id, raw, digest(string(raw))).Error
}
func (s *Service) StartTimestampWorkflow(ctx context.Context, api TimestampAPI, scope string) {
	s.timestampAPI = api
	s.timestampScope = scope
	go func() {
		if ctx.Err() != nil {
			return
		}
		ticker := time.NewTicker(10 * time.Second)
		defer ticker.Stop()
		for {
			if e := s.ProcessTimestampQueue(ctx); e != nil && ctx.Err() == nil {
				s.logger.Warn("Tapyrus API queue processing failed")
			}
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
}
func (s *Service) ProcessTimestampQueue(ctx context.Context) error {
	if s.timestampAPI == nil {
		return nil
	}
	var job apiRegistration
	create := false
	e := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		e := tx.Table("integrity.api_registrations").Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"}).Where("status <> 'confirmed' AND updated_at < now()-interval '30 seconds' AND (provider_scope IS NULL OR provider_scope=?)", s.timestampScope).Order("updated_at").Take(&job).Error
		if e == gorm.ErrRecordNotFound {
			return nil
		}
		if e != nil {
			return e
		}
		if job.ProviderScope != nil && *job.ProviderScope != s.timestampScope {
			return nil
		}
		create = job.Status == "queued" || job.Status == "failed"
		status := job.Status
		if create {
			status = "submitting"
		}
		if e = tx.Table("integrity.api_registrations").Where("id=?", job.ID).Updates(map[string]any{"status": status, "provider_scope": s.timestampScope, "attempts": gorm.Expr("attempts+1"), "updated_at": time.Now().UTC()}).Error; e != nil {
			return e
		}
		return workflowSystemAudit(ctx, tx, job.SubjectID, "api."+status, apiSubjectKind(job.SubjectType))
	})
	if e != nil || job.ID == "" {
		return e
	}
	if job.ProviderScope != nil && *job.ProviderScope != s.timestampScope {
		return nil
	}
	var t tapyrusapi.Timestamp
	switch {
	case job.TimestampID != nil:
		t, e = s.timestampAPI.Get(ctx, *job.TimestampID)
	case create:
		t, e = s.timestampAPI.Create(ctx, job.ManifestHash)
	default:
		var found *tapyrusapi.Timestamp
		found, e = s.timestampAPI.Find(ctx, job.ManifestHash)
		if e == nil && found != nil {
			t = *found
		} else if e == nil {
			e = tapyrusapi.ErrUncertain
		}
	}
	status := "unknown"
	if e == nil {
		e = tapyrusapi.Validate(t, job.ManifestHash)
		if e == nil && job.Txid != nil && *job.Txid != t.Txid {
			e = tapyrusapi.ErrMismatch
		}
		if e == nil {
			status = t.Status
		}
	}
	// A definite rejection before an ID is returned is safe to retry. Transport,
	// server and malformed-response errors always stay in recovery-only mode.
	var rejected *tapyrusapi.RejectedError
	if create && errors.As(e, &rejected) {
		status = "failed"
	}
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var current apiRegistration
		if err := tx.Table("integrity.api_registrations").Clauses(clause.Locking{Strength: "UPDATE"}).Where("id=?", job.ID).Take(&current).Error; err != nil {
			return err
		}
		if current.Status == "confirmed" {
			return nil
		}
		updates := map[string]any{"status": status, "updated_at": time.Now().UTC()}
		if e == nil {
			raw, _ := json.Marshal(t)
			updates["timestamp_id"] = t.ID
			updates["txid"] = t.Txid
			updates["provider_result"] = string(raw)
			if status == "confirmed" {
				updates["confirmed_at"] = time.Now().UTC()
			}
		}
		if err := tx.Table("integrity.api_registrations").Where("id=?", job.ID).Updates(updates).Error; err != nil {
			return err
		}
		return workflowSystemAudit(ctx, tx, job.SubjectID, "api."+status, apiSubjectKind(job.SubjectType))
	})
}
func (s *Service) verifyTimestamp(ctx context.Context, job apiRegistration) (string, error) {
	if s.timestampAPI == nil || job.TimestampID == nil || job.Status != "confirmed" || job.ProviderScope == nil || *job.ProviderScope != s.timestampScope {
		return "unverifiable", nil
	}
	t, e := s.timestampAPI.Get(ctx, *job.TimestampID)
	if e != nil {
		return "unverifiable", nil
	}
	if e = tapyrusapi.Validate(t, job.ManifestHash); errors.Is(e, tapyrusapi.ErrMismatch) {
		return "mismatch", nil
	}
	if job.Txid == nil || t.Txid != *job.Txid {
		return "mismatch", nil
	}
	if e != nil || t.Status != "confirmed" {
		return "unverifiable", nil
	}
	if digest(string(job.Manifest)) != job.ManifestHash {
		return "mismatch", nil
	}
	return "match", nil
}

func apiSubjectKind(subject string) string {
	switch subject {
	case "case_start":
		return "case_start_request"
	case "event_approval", "event_completion":
		return "case_event"
	default:
		return "record_version"
	}
}
