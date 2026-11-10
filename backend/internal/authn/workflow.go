package authn

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/labstack/echo/v5"
	"github.com/nao317/mobile_tracer/backend/internal/business"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type workflowVersion struct {
	ID, TenantID, CaseID, RecordID, Status string
	LockVersion                            int
}
type workflowMedia struct {
	ID               string     `json:"id"`
	Position         string     `json:"position"`
	MimeType         string     `json:"mime_type"`
	SHA256           string     `json:"sha256" gorm:"column:sha256"`
	ActorID          string     `json:"actor_id"`
	DeviceCapturedAt *time.Time `json:"device_captured_at"`
	Latitude         *float64   `json:"latitude"`
	Longitude        *float64   `json:"longitude"`
	LocationLabel    *string    `json:"location_label"`
	CapturedAtSource *string    `json:"captured_at_source"`
	LocationSource   *string    `json:"location_source"`
	CreatedAt        time.Time  `json:"created_at"`
}
type workflowRequest struct {
	ID            string     `json:"id"`
	VersionID     string     `json:"version_id"`
	UserID        string     `json:"user_id"`
	Qualification string     `json:"qualification"`
	Kind          string     `json:"kind"`
	Statement     string     `json:"statement"`
	Deadline      time.Time  `json:"deadline"`
	Decision      *string    `json:"decision"`
	RespondedAt   *time.Time `json:"responded_at"`
}
type workflowAnchor struct {
	VersionID    string     `json:"version_id"`
	Manifest     []byte     `json:"-"`
	ManifestHash string     `json:"manifest_hash"`
	Status       string     `json:"status"`
	RawTx        *string    `json:"-"`
	Txid         *string    `json:"txid"`
	Attempts     int        `json:"attempts"`
	UpdatedAt    time.Time  `json:"updated_at"`
	RegisteredAt *time.Time `json:"registered_at"`
}
type workflowContent struct {
	PresentedBy string           `json:"presented_by"`
	PresentedAt *time.Time       `json:"presented_at"`
	Schema      string           `json:"schema"`
	Version     business.Version `json:"version"`
	Case        business.Case    `json:"case"`
	Vehicle     business.Vehicle `json:"vehicle"`
	Media       []workflowMedia  `json:"media"`
}
type workflowDocument struct {
	APIConfigured bool              `json:"api_configured"`
	Content       workflowContent   `json:"content"`
	Requests      []workflowRequest `json:"requests"`
	Anchor        *workflowAnchor   `json:"anchor"`
	CanManage     bool              `json:"can_manage"`
}

func canonical(value any) ([]byte, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	var normal any
	// Decode with UseNumber so amounts and large integers retain their exact value.
	normal, err = decodeCanonical(raw)
	if err != nil {
		return nil, err
	}
	return json.Marshal(normal)
}
func (s *Service) workflowAuth(c *echo.Context) (Authenticated, error) {
	a, err := s.Authenticate(c.Request())
	if err != nil {
		return a, err
	}
	if !safe(c.Request().Method) {
		err = s.csrf(c.Request(), a.Session)
	}
	return a, err
}
func workflowVersionRow(db *gorm.DB, id string, lock bool) (workflowVersion, error) {
	var v workflowVersion
	q := db.Table("app.record_versions").Where("id=?", id)
	if lock {
		q = q.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	err := q.Take(&v).Error
	return v, err
}
func (s *Service) workflowStaff(c *echo.Context, db *gorm.DB, v workflowVersion) (business.Principal, error) {
	p, err := s.AuthorizeBusiness(c.Request())
	if err != nil {
		return p, err
	}
	_, err = business.New(db).Case(c.Request().Context(), p, v.CaseID)
	return p, err
}
func workflowWriteAllowed(p business.Principal, item business.Case) bool {
	for _, r := range p.Roles {
		if r.Role == "auditor" {
			continue
		}
		if r.StoreID != nil && *r.StoreID != item.StoreID {
			continue
		}
		if r.Role == "tenant_admin" || r.Role == "store_manager" || (r.Role == "staff" && (item.CreatedBy == p.StaffID || item.AssigneeID != nil && *item.AssigneeID == p.StaffID)) {
			return true
		}
	}
	return false
}
func (s *Service) workflowAccess(c *echo.Context, db *gorm.DB, a Authenticated, v workflowVersion) (bool, error) {
	// Customer access is version specific. A relationship never opens older versions.
	var n int64
	err := db.Table("app.workflow_requests q").Joins("JOIN app.tenants t ON t.id=? AND t.status='active'", v.TenantID).Where("q.version_id=? AND q.user_id=?", v.ID, a.User.ID).Count(&n).Error
	if err != nil {
		return false, err
	}
	if n > 0 {
		return false, nil
	}
	p, err := s.workflowStaff(c, db, v)
	if err != nil {
		return false, business.NotFound()
	}
	item, err := business.New(db).Case(c.Request().Context(), p, v.CaseID)
	return workflowWriteAllowed(p, item), err
}
func workflowRequests(db *gorm.DB, id string) ([]workflowRequest, error) {
	rows := []workflowRequest{}
	err := db.Table("app.workflow_requests q").Select("q.*, r.decision, r.created_at AS responded_at").Joins("LEFT JOIN app.workflow_responses r ON r.request_id=q.id").Where("q.version_id=?", id).Order("q.id").Find(&rows).Error
	return rows, err
}
func workflowContentFor(ctx context.Context, db *gorm.DB, p business.Principal, v workflowVersion) (workflowContent, error) {
	svc := business.New(db)
	result := workflowContent{Schema: "mobile-tracer/record/v1", Media: []workflowMedia{}}
	var err error
	result.Version, err = svc.Version(ctx, p, v.CaseID, v.RecordID, v.ID)
	if err != nil {
		return result, err
	}
	result.Case, err = svc.Case(ctx, p, v.CaseID)
	if err != nil {
		return result, err
	}
	result.Vehicle, err = svc.Vehicle(ctx, p, result.Case.VehicleID)
	if err != nil {
		return result, err
	}
	err = db.Table("app.workflow_media").Where("record_version_id=?", v.ID).Order("position,id").Find(&result.Media).Error
	// Submission changes these fields. The independent presentation fixes the
	// business content, while submitter/time are kept in the version and audit.
	result.Version.Status = "submitted"
	result.Version.ContentHash = nil
	result.Version.HashAlgorithm = nil
	result.Version.SubmittedAt = nil
	result.Version.SubmittedBy = nil
	result.Version.VehicleSnapshot = nil
	return result, err
}
func (s *Service) workflowDocument(c *echo.Context, a Authenticated, v workflowVersion) (workflowDocument, error) {
	db := s.db.WithContext(c.Request().Context())
	manage, err := s.workflowAccess(c, db, a, v)
	if err != nil {
		return workflowDocument{}, err
	}
	var stored struct{ Content []byte }
	err = db.Table("app.workflow_presentations").Where("version_id=?", v.ID).Take(&stored).Error
	var content workflowContent
	if err == gorm.ErrRecordNotFound {
		p, e := s.workflowStaff(c, db, v)
		if e != nil {
			return workflowDocument{}, business.NotFound()
		}
		content, err = workflowContentFor(c.Request().Context(), db, p, v)
		content.Version.Status = v.Status
	} else if err == nil {
		err = json.Unmarshal(stored.Content, &content)
	}
	if err != nil {
		return workflowDocument{}, err
	}
	requests, err := workflowRequests(db, v.ID)
	if err != nil {
		return workflowDocument{}, err
	}
	// Customers see their own answers, not other customers' identities.
	if !manage {
		filtered := []workflowRequest{}
		for _, q := range requests {
			if q.UserID == a.User.ID {
				filtered = append(filtered, q)
			}
		}
		requests = filtered
	}
	var anchor workflowAnchor
	err = db.Table("app.workflow_anchors").Where("version_id=?", v.ID).Take(&anchor).Error
	result := workflowDocument{Content: content, Requests: requests, CanManage: manage, APIConfigured: s.timestampAPI != nil}
	var registration apiRegistration
	if e := db.Table("integrity.api_registrations").Where("subject_type='record' AND subject_id=?", v.ID).Take(&registration).Error; e == nil {
		status := map[string]string{"queued": "queued", "submitting": "sending", "unconfirmed": "sending", "confirmed": "registered", "unknown": "unknown", "failed": "failed"}[registration.Status]
		result.Anchor = &workflowAnchor{VersionID: v.ID, ManifestHash: registration.ManifestHash, Status: status, Txid: registration.Txid, Attempts: registration.Attempts, UpdatedAt: registration.UpdatedAt, RegisteredAt: registration.ConfirmedAt}
		return result, nil
	}
	if err == nil {
		result.Anchor = &anchor
	} else if err != gorm.ErrRecordNotFound {
		return result, err
	}
	return result, nil
}
func (s *Service) RegisterWorkflow(e *echo.Echo) {
	g := e.Group("/api/transactions", func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c *echo.Context) error {
			c.Response().Header().Set("Cache-Control", "no-store")
			c.Response().Header().Set("X-Content-Type-Options", "nosniff")
			c.Request().Body = http.MaxBytesReader(c.Response(), c.Request().Body, 11<<20)
			a, err := s.workflowAuth(c)
			if err != nil {
				return err
			}
			c.Set("workflow.actor", a)
			if id := c.Param("versionID"); id != "" && !business.ValidID(id) {
				return business.NotFound()
			}
			return next(c)
		}
	})
	s.registerWorkflowSharing(g)
	actor := func(c *echo.Context) Authenticated { return c.Get("workflow.actor").(Authenticated) }
	g.GET("", func(c *echo.Context) error {
		a := actor(c)
		db := s.db.WithContext(c.Request().Context())
		type item struct {
			VersionID string  `json:"version_id"`
			CaseID    string  `json:"case_id"`
			RecordID  string  `json:"record_id"`
			VersionNo int     `json:"version_no"`
			Status    string  `json:"status"`
			VehicleID string  `json:"vehicle_id"`
			ModelName *string `json:"model_name"`
		}
		page, size, err := workflowPage(c)
		if err != nil {
			return err
		}
		q := db.Table("app.record_versions v").Select("v.id AS version_id,v.case_id,v.record_id,v.version_no,v.status,c.vehicle_id,ve.model_name").Joins("JOIN app.cases c ON c.id=v.case_id").Joins("JOIN app.vehicles ve ON ve.id=c.vehicle_id").Joins("JOIN app.tenants t ON t.id=c.tenant_id AND t.status='active'")
		p, pErr := s.AuthorizeBusiness(c.Request())
		if pErr != nil {
			q = q.Where("EXISTS(SELECT 1 FROM app.workflow_requests wr WHERE wr.version_id=v.id AND wr.user_id=?)", a.User.ID)
		} else {
			cond := db.Session(&gorm.Session{NewDB: true}).Where("1=0")
			for _, r := range p.Roles {
				term := db.Session(&gorm.Session{NewDB: true}).Where("c.tenant_id=?", p.TenantID)
				if r.StoreID != nil {
					term = term.Where("c.store_id=?", *r.StoreID)
				}
				if r.Role == "staff" {
					term = term.Where("c.created_by=? OR c.assignee_id=?", p.StaffID, p.StaffID)
				}
				cond = cond.Or(term)
			}
			q = q.Where(cond)
		}
		if search := c.QueryParam("q"); search != "" {
			q = q.Where("ve.model_name ILIKE ?", "%"+likeQuery(search)+"%")
		}
		if vehicle := c.QueryParam("vehicle_id"); vehicle != "" {
			if !business.ValidID(vehicle) {
				return business.NotFound()
			}
			q = q.Where("c.vehicle_id=?", vehicle)
		}
		var total int64
		if err = q.Count(&total).Error; err != nil {
			return err
		}
		rows := []item{}
		if err = q.Order("v.created_at DESC,v.id").Limit(size).Offset((page - 1) * size).Scan(&rows).Error; err != nil {
			return err
		}
		return c.JSON(200, map[string]any{"data": rows, "pagination": business.Pagination{Page: page, PageSize: size, Total: total}})
	})
	g.GET("/:versionID", func(c *echo.Context) error {
		v, err := workflowVersionRow(s.db, c.Param("versionID"), false)
		if err != nil {
			return err
		}
		d, err := s.workflowDocument(c, actor(c), v)
		if err != nil {
			return err
		}
		return c.JSON(200, map[string]any{"data": d})
	})
	g.POST("/:versionID/present", s.presentWorkflow)
	g.POST("/:versionID/respond", s.respondWorkflow)
	g.POST("/:versionID/media", s.uploadWorkflowMedia)
	g.GET("/:versionID/media/:mediaID", s.readWorkflowMedia)
	g.POST("/:versionID/correct", func(c *echo.Context) error {
		v, err := workflowVersionRow(s.db, c.Param("versionID"), false)
		if err != nil {
			return err
		}
		p, err := s.workflowStaff(c, s.db, v)
		if err != nil {
			return err
		}
		var in struct {
			Reason string `json:"reason"`
		}
		if err = decodeJSON(c.Request(), &in); err != nil {
			return err
		}
		draft, err := s.business.Correct(c.Request().Context(), p, v.CaseID, v.RecordID, v.ID, in.Reason)
		if err != nil {
			return err
		}
		return c.JSON(201, map[string]any{"data": draft})
	})
	g.POST("/:versionID/retry", func(c *echo.Context) error {
		v, err := workflowVersionRow(s.db, c.Param("versionID"), false)
		if err != nil {
			return err
		}
		manage, err := s.workflowAccess(c, s.db, actor(c), v)
		if err != nil {
			return err
		}
		if !manage {
			return business.Forbidden()
		}
		err = s.db.WithContext(c.Request().Context()).Transaction(func(tx *gorm.DB) error {
			qs, err := workflowRequests(tx, v.ID)
			if err != nil {
				return err
			}
			if !workflowApproved(qs) {
				return business.Conflict("必要な顧客承認が揃っていません。")
			}
			if err := queueWorkflow(tx, v.ID); err != nil {
				return err
			}
			return workflowAudit(c.Request().Context(), tx, actor(c).User, "transaction.retry", "record_version", v.ID, map[string]any{})
		})
		if err != nil {
			return err
		}
		return c.JSON(200, map[string]any{"data": "queued"})
	})
	g.POST("/:versionID/verify", s.verifyWorkflow)
	g.GET("/:versionID/ownerships", s.listWorkflowOwners)
	g.POST("/:versionID/ownerships", s.addWorkflowOwner)
}
func (s *Service) presentWorkflow(c *echo.Context) error {
	a := c.Get("workflow.actor").(Authenticated)
	var in struct {
		LockVersion int    `json:"lock_version"`
		RequestKey  string `json:"request_key"`
		Recipients  []struct {
			Email         string    `json:"email"`
			Qualification string    `json:"qualification"`
			Kind          string    `json:"kind"`
			Statement     string    `json:"statement"`
			Deadline      time.Time `json:"deadline"`
		} `json:"recipients"`
	}
	if err := decodeJSON(c.Request(), &in); err != nil {
		return err
	}
	if !business.ValidID(in.RequestKey) || len(in.Recipients) == 0 || len(in.Recipients) > 20 {
		return business.Invalid("recipients", "承認先と再送キーを指定してください。")
	}
	err := s.db.WithContext(c.Request().Context()).Transaction(func(tx *gorm.DB) error {
		// Same lock order as draft editing, uploads and corrections: case then version.
		v, err := workflowVersionRow(tx, c.Param("versionID"), false)
		if err != nil {
			return err
		}
		p, err := s.workflowStaff(c, tx, v)
		if err != nil {
			return err
		}
		var locked struct{ ID string }
		if err = tx.Table("app.cases").Clauses(clause.Locking{Strength: "UPDATE"}).Where("id=?", v.CaseID).Take(&locked).Error; err != nil {
			return err
		}
		v, err = workflowVersionRow(tx, v.ID, true)
		if err != nil {
			return err
		}
		if v.Status == "submitted" {
			var existing struct{ SubmitIdempotencyKey string }
			if err = tx.Table("app.record_versions").Where("id=?", v.ID).Take(&existing).Error; err != nil {
				return err
			}
			if existing.SubmitIdempotencyKey == in.RequestKey {
				return nil
			}
			return business.Conflict("提出済みです。変更には訂正版を作成してください。")
		}
		hasAgreement := false
		requests := []map[string]any{}
		seen := map[string]bool{}
		for _, r := range in.Recipients {
			if r.Kind == "state_agreement" || r.Kind == "work_authorization" {
				hasAgreement = true
			}
			if !r.Deadline.After(time.Now()) || r.Deadline.After(time.Now().Add(365*24*time.Hour)) || len(r.Statement) == 0 || len(r.Statement) > 4000 {
				return business.Invalid("recipients", "確認文面と将来の回答期限を指定してください。")
			}
			var u User
			if err = tx.Table("auth.users").Where("lower(email)=lower(?) AND status='active' AND email_verified=true AND account_type='general'", r.Email).Take(&u).Error; err != nil {
				return business.Invalid("recipients", "有効な一般ユーザーを指定してください。")
			}
			if u.ID == a.User.ID {
				return business.Forbidden()
			}
			key := u.ID + ":" + r.Kind
			if seen[key] {
				return business.Invalid("recipients", "同じ確認先が重複しています。")
			}
			seen[key] = true
			requests = append(requests, map[string]any{"version_id": v.ID, "user_id": u.ID, "qualification": r.Qualification, "kind": r.Kind, "statement": r.Statement, "deadline": r.Deadline})
		}
		if !hasAgreement {
			return business.Invalid("recipients", "状態同意または作業承認が必要です。")
		}
		content, err := workflowContentFor(c.Request().Context(), tx, p, v)
		if err != nil {
			return err
		}
		if len(content.Media) == 0 {
			return business.Invalid("media", "写真を保存してください。")
		}
		presentedAt := time.Now().UTC()
		content.PresentedBy = a.User.ID
		content.PresentedAt = &presentedAt
		bytes, err := canonical(content)
		if err != nil {
			return err
		}
		if err = business.New(tx).Submit(c.Request().Context(), p, v.CaseID, v.RecordID, v.ID, in.RequestKey, digest(string(bytes)), in.LockVersion); err != nil {
			return err
		}
		if err = tx.Table("app.workflow_presentations").Create(map[string]any{"version_id": v.ID, "content": bytes, "content_hash": digest(string(bytes)), "actor_id": a.User.ID}).Error; err != nil {
			return err
		}
		for _, r := range requests {
			if err = tx.Table("app.workflow_requests").Create(r).Error; err != nil {
				return err
			}
		}
		return workflowAudit(c.Request().Context(), tx, a.User, "transaction.present", "record_version", v.ID, map[string]any{"recipients": len(requests)})
	})
	if err != nil {
		return err
	}
	return c.JSON(200, map[string]any{"data": "presented"})
}
func (s *Service) respondWorkflow(c *echo.Context) error {
	a := c.Get("workflow.actor").(Authenticated)
	var in struct {
		RequestID string `json:"request_id"`
		Decision  string `json:"decision"`
	}
	if err := decodeJSON(c.Request(), &in); err != nil {
		return err
	}
	if !business.ValidID(in.RequestID) || (in.Decision != "approved" && in.Decision != "rejected" && in.Decision != "held") {
		return business.Invalid("decision", "回答を選択してください。")
	}
	err := s.db.WithContext(c.Request().Context()).Transaction(func(tx *gorm.DB) error {
		v, err := workflowVersionRow(tx, c.Param("versionID"), true)
		if err != nil {
			return err
		}
		if _, err = s.workflowAccess(c, tx, a, v); err != nil {
			return err
		}
		var q workflowRequest
		if err = tx.Table("app.workflow_requests").Where("id=? AND version_id=? AND user_id=?", in.RequestID, v.ID, a.User.ID).Take(&q).Error; err != nil {
			return err
		}
		var old struct{ Decision string }
		err = tx.Table("app.workflow_responses").Where("request_id=?", q.ID).Take(&old).Error
		if err == nil {
			if old.Decision == in.Decision {
				return nil
			}
			return business.Conflict("回答済みです。変更には新しい提示が必要です。")
		}
		if err != gorm.ErrRecordNotFound {
			return err
		}
		if !time.Now().Before(q.Deadline) {
			return business.Conflict("回答期限を過ぎています。業者に再提示を依頼してください。")
		}
		if err = tx.Table("app.workflow_responses").Create(map[string]any{"request_id": q.ID, "actor_id": a.User.ID, "decision": in.Decision}).Error; err != nil {
			return err
		}
		if err = workflowAudit(c.Request().Context(), tx, a.User, "transaction.respond", "record_version", v.ID, map[string]any{"request_id": q.ID, "decision": in.Decision, "qualification": q.Qualification, "kind": q.Kind}); err != nil {
			return err
		}
		return queueWorkflow(tx, v.ID)
	})
	if err != nil {
		return err
	}
	return c.JSON(200, map[string]any{"data": "answered"})
}
func queueWorkflow(tx *gorm.DB, id string) error {
	qs, err := workflowRequests(tx, id)
	if err != nil {
		return err
	}
	if !workflowApproved(qs) {
		return nil
	}
	var content struct{ Content []byte }
	if err = tx.Table("app.workflow_presentations").Where("version_id=?", id).Take(&content).Error; err != nil {
		return err
	}
	bytes, err := canonical(struct {
		Schema      string            `json:"schema"`
		ContentHash string            `json:"content_hash"`
		Approvals   []workflowRequest `json:"approvals"`
	}{"mobile-tracer/anchor/v1", digest(string(content.Content)), qs})
	if err != nil {
		return err
	}
	if err := tx.Exec(`INSERT INTO app.workflow_anchors(version_id,manifest,manifest_hash) VALUES(?,?,?) ON CONFLICT(version_id) DO NOTHING`, id, bytes, digest(string(bytes))).Error; err != nil {
		return err
	}
	return tx.Exec(`INSERT INTO integrity.api_registrations(subject_type,subject_id,manifest,manifest_hash) VALUES('record',?,?,?) ON CONFLICT(subject_type,subject_id) DO NOTHING`, id, bytes, digest(string(bytes))).Error
}
func workflowApproved(qs []workflowRequest) bool {
	agreement := false
	if len(qs) == 0 {
		return false
	}
	for _, q := range qs {
		if q.Kind == "state_agreement" || q.Kind == "work_authorization" {
			agreement = true
		}
		if q.Decision == nil || *q.Decision != "approved" || q.RespondedAt == nil || q.RespondedAt.After(q.Deadline) {
			return false
		}
	}
	return agreement
}

func workflowPage(c *echo.Context) (int, int, error) {
	for key, values := range c.QueryParams() {
		if len(values) != 1 || (key != "page" && key != "page_size" && key != "q" && key != "vehicle_id") {
			return 0, 0, business.Invalid("query", "検索条件を確認してください。")
		}
	}

	q := c.QueryParam("vehicle_id")
	c.QueryParams().Del("vehicle_id")
	page, size, err := managementPage(c)
	if q != "" {
		c.QueryParams().Set("vehicle_id", q)
	}
	return page, size, err
}

func workflowAudit(ctx context.Context, tx *gorm.DB, actor User, action, kind, id string, details any) error {
	encoded, err := json.Marshal(details)
	if err != nil {
		return err
	}
	actingAs := "customer"
	if actor.AccountType == "business" {
		actingAs = "business_staff"
	}
	at := time.Now().UTC()
	return tx.WithContext(ctx).Table("audit.events").Create(map[string]any{"actor_type": "user", "actor_id": actor.ID, "acting_as": actingAs, "action": action, "target_type": kind, "target_id": id, "result": "succeeded", "created_at": at, "details": string(encoded), "entry_hash": digest(actor.ID + action + id + string(encoded) + at.Format(time.RFC3339Nano))}).Error
}
