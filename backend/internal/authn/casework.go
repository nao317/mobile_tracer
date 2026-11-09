package authn

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/labstack/echo/v5"
	"github.com/nao317/mobile_tracer/backend/internal/business"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type caseStart struct {
	ID          string     `json:"id"`
	CaseID      string     `json:"case_id"`
	VersionNo   int        `json:"version_no"`
	CustomerID  string     `json:"customer_id"`
	ActorID     string     `json:"actor_id"`
	Terms       []byte     `json:"-"`
	TermsHash   string     `json:"terms_hash"`
	Deadline    time.Time  `json:"deadline"`
	RequestKey  string     `json:"-"`
	CreatedAt   time.Time  `json:"created_at"`
	Decision    *string    `json:"decision"`
	RespondedAt *time.Time `json:"responded_at"`
}
type caseTerms struct {
	CompanyName string           `json:"company_name"`
	StoreName   string           `json:"store_name"`
	Schema      string           `json:"schema"`
	Case        business.Case    `json:"case"`
	Vehicle     business.Vehicle `json:"vehicle"`
	Terms       string           `json:"terms"`
	CustomerID  string           `json:"customer_id"`
	ActorID     string           `json:"actor_id"`
	Deadline    time.Time        `json:"deadline"`
}
type caseworkDocument struct {
	NextStages    []string          `json:"next_stages"`
	Case          business.Case     `json:"case"`
	Vehicle       business.Vehicle  `json:"vehicle"`
	Start         caseStart         `json:"start"`
	Terms         caseTerms         `json:"terms"`
	CanManage     bool              `json:"can_manage"`
	Events        []caseEventView   `json:"events"`
	Registrations []apiRegistration `json:"registrations"`
	APIConfigured bool              `json:"api_configured"`
}

func (s *Service) caseworkAccess(c *echo.Context, db *gorm.DB, id string, lock bool) (business.Case, *business.Principal, error) {
	var row business.Case
	q := db.Table("app.cases").Where("id=?", id)
	if lock {
		q = q.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	if e := q.Take(&row).Error; e != nil {
		return row, nil, e
	}
	a := c.Get("workflow.actor").(Authenticated)
	p, e := s.AuthorizeBusiness(c.Request())
	if e == nil {
		item, e := business.New(db).Case(c.Request().Context(), p, id)
		if e == nil {
			return item, &p, nil
		}
	}
	// Only the current named customer can access the case. Their prior proposals
	// remain independently available in the start-request inbox.
	var n int64
	e = db.Table("app.case_start_requests q").Joins("JOIN app.cases ac ON ac.id=q.case_id JOIN app.tenants t ON t.id=ac.tenant_id AND t.status='active'").Where("q.case_id=? AND q.customer_id=? AND q.version_no=(SELECT max(version_no) FROM app.case_start_requests WHERE case_id=?)", id, a.User.ID, id).Count(&n).Error
	if e != nil {
		return row, nil, e
	}
	if n == 0 {
		return row, nil, business.NotFound()
	}
	return row, nil, nil
}
func latestCaseStart(db *gorm.DB, id string) (caseStart, error) {
	var q caseStart
	e := db.Table("app.case_start_requests q").Select("q.*,r.decision,r.created_at AS responded_at").Joins("LEFT JOIN app.case_start_responses r ON r.request_id=q.id").Where("q.case_id=?", id).Order("q.version_no DESC").Take(&q).Error
	return q, e
}
func (s *Service) RegisterCasework(e *echo.Echo) {
	g := e.Group("/api/casework", func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c *echo.Context) error {
			c.Response().Header().Set("Cache-Control", "no-store")
			c.Request().Body = http.MaxBytesReader(c.Response(), c.Request().Body, 128<<10)
			a, e := s.workflowAuth(c)
			if e != nil {
				return e
			}
			c.Set("workflow.actor", a)
			for _, key := range []string{"caseID", "requestID", "eventID"} {
				if value := c.Param(key); value != "" && !business.ValidID(value) {
					return business.NotFound()
				}
			}
			return next(c)
		}
	})
	g.GET("", s.listCasework)
	g.GET("/starts", s.listCaseStarts)
	g.POST("/starts", s.createCaseStart)
	g.POST("/starts/:requestID/respond", s.respondCaseStart)
	g.GET("/:caseID", s.getCasework)
	g.POST("/:caseID/events", s.createCaseEvent)
	g.POST("/:caseID/events/:eventID/actions", s.actCaseEvent)
	g.POST("/:caseID/verify/:registrationID", s.verifyCasework)
}
func (s *Service) listCasework(c *echo.Context) error {
	a := c.Get("workflow.actor").(Authenticated)
	db := s.db.WithContext(c.Request().Context())
	page, size, e := managementPage(c)
	if e != nil {
		return e
	}
	q := db.Table("app.cases c").Select("c.*,EXISTS(SELECT 1 FROM app.case_start_requests WHERE case_id=c.id) AS has_start").Joins("JOIN app.tenants t ON t.id=c.tenant_id AND t.status='active'")
	p, err := s.AuthorizeBusiness(c.Request())
	if err != nil {
		q = q.Where("EXISTS(SELECT 1 FROM app.case_start_requests sr WHERE sr.case_id=c.id AND sr.customer_id=? AND sr.version_no=(SELECT max(version_no) FROM app.case_start_requests WHERE case_id=c.id))", a.User.ID)
	} else {
		scope := db.Session(&gorm.Session{NewDB: true}).Where("1=0")
		for _, r := range p.Roles {
			part := db.Session(&gorm.Session{NewDB: true}).Where("c.tenant_id=?", p.TenantID)
			if r.StoreID != nil {
				part = part.Where("c.store_id=?", *r.StoreID)
			}
			if r.Role == "staff" {
				part = part.Where("c.assignee_id=? OR c.created_by=?", p.StaffID, p.StaffID)
			}
			scope = scope.Or(part)
		}
		q = q.Where(scope)
	}
	if v := c.QueryParam("q"); v != "" {
		q = q.Where("EXISTS(SELECT 1 FROM app.vehicles v WHERE v.id=c.vehicle_id AND v.model_name ILIKE ?)", "%"+likeQuery(v)+"%")
	}
	var total int64
	if e = q.Count(&total).Error; e != nil {
		return e
	}
	type caseListItem struct {
		business.Case
		HasStart bool `json:"has_start"`
	}
	rows := []caseListItem{}
	if e = q.Order("c.created_at DESC,c.id").Limit(size).Offset((page - 1) * size).Scan(&rows).Error; e != nil {
		return e
	}
	return c.JSON(200, map[string]any{"data": rows, "pagination": business.Pagination{Page: page, PageSize: size, Total: total}, "api_configured": s.timestampAPI != nil})
}
func (s *Service) listCaseStarts(c *echo.Context) error {
	a := c.Get("workflow.actor").(Authenticated)
	rows := []caseStart{}
	e := s.db.WithContext(c.Request().Context()).Table("app.case_start_requests q").Select("q.*,r.decision,r.created_at AS responded_at").Joins("LEFT JOIN app.case_start_responses r ON r.request_id=q.id").Where("q.customer_id=?", a.User.ID).Order("q.created_at DESC").Limit(100).Find(&rows).Error
	if e != nil {
		return e
	}
	type entry struct {
		Request caseStart `json:"request"`
		Terms   caseTerms `json:"terms"`
	}
	result := []entry{}
	for _, row := range rows {
		var content caseTerms
		if e = json.Unmarshal(row.Terms, &content); e != nil {
			return e
		}
		result = append(result, entry{row, content})
	}
	return c.JSON(200, map[string]any{"data": result})
}
func (s *Service) createCaseStart(c *echo.Context) error {
	a := c.Get("workflow.actor").(Authenticated)
	p, e := s.AuthorizeBusiness(c.Request())
	if e != nil {
		return e
	}
	var in struct {
		CaseID                 string    `json:"case_id"`
		StoreID                string    `json:"store_id"`
		VehicleID              string    `json:"vehicle_id"`
		CaseType               string    `json:"case_type"`
		ConfigurationVersionID string    `json:"configuration_version_id"`
		AssigneeID             *string   `json:"assignee_id"`
		Email                  string    `json:"email"`
		Terms                  string    `json:"terms"`
		Deadline               time.Time `json:"deadline"`
		RequestKey             string    `json:"request_key"`
	}
	if e = decodeJSON(c.Request(), &in); e != nil {
		return e
	}
	if !business.ValidID(in.RequestKey) || strings.TrimSpace(in.Terms) == "" || len(in.Terms) > 8000 || !validCaseDeadline(in.Deadline) {
		return business.Invalid("terms", "案件条件・回答期限・再送キーを確認してください。")
	}
	in.Deadline = in.Deadline.UTC().Truncate(time.Microsecond)
	var result caseStart
	e = s.db.WithContext(c.Request().Context()).Transaction(func(tx *gorm.DB) error {
		// Serialize repeated keys, including concurrent requests that create a new case.
		if err := tx.Exec("SELECT pg_advisory_xact_lock(hashtextextended(?,0))", in.RequestKey).Error; err != nil {
			return err
		}
		var customer User
		if err := tx.Table("auth.users").Where("lower(email)=lower(?) AND status='active' AND email_verified=true AND account_type='general'", in.Email).Take(&customer).Error; err != nil || customer.ID == a.User.ID {
			return business.Invalid("email", "登録済みの一般ユーザーを指定してください。")
		}
		err := tx.Table("app.case_start_requests").Where("request_key=?", in.RequestKey).Take(&result).Error
		if err == nil {
			if result.ActorID != a.User.ID {
				return business.NotFound()
			}
			var content caseTerms
			if json.Unmarshal(result.Terms, &content) != nil {
				return business.Conflict("提示内容を確認できません。")
			}
			if content.Terms != in.Terms || !result.Deadline.Equal(in.Deadline) || result.CustomerID != customer.ID || (in.CaseID != "" && result.CaseID != in.CaseID) || (in.CaseID == "" && (content.Case.StoreID != in.StoreID || content.Case.VehicleID != in.VehicleID || content.Case.CaseType != in.CaseType || content.Case.ConfigurationVersionID != in.ConfigurationVersionID)) {
				return business.Conflict("再送キーの内容が異なります。")
			}
			return nil
		}
		if err != gorm.ErrRecordNotFound {
			return err
		}
		var item business.Case
		if in.CaseID != "" {
			if !business.ValidID(in.CaseID) {
				return business.NotFound()
			}
			item, err = business.New(tx).Case(c.Request().Context(), p, in.CaseID)
			if err != nil {
				return err
			}
			if !workflowWriteAllowed(p, item) {
				return business.Forbidden()
			}
			if err = tx.Table("app.cases").Clauses(clause.Locking{Strength: "UPDATE"}).Where("id=?", item.ID).Take(&item).Error; err != nil {
				return err
			}
			if item.Status != "awaiting_customer" {
				return business.Conflict("開始承認待ちの案件だけ再提示できます。")
			}
		} else {
			item, err = business.New(tx).CreateCase(c.Request().Context(), p, business.CaseCreate{StoreID: in.StoreID, VehicleID: in.VehicleID, CaseType: in.CaseType, ConfigurationVersionID: in.ConfigurationVersionID, AssigneeID: in.AssigneeID})
			if err != nil {
				return err
			}
		}
		vehicle, err := business.New(tx).Vehicle(c.Request().Context(), p, item.VehicleID)
		if err != nil {
			return err
		}
		var names struct{ CompanyName, StoreName string }
		if err = tx.Table("app.cases c").Select("t.name AS company_name,st.name AS store_name").Joins("JOIN app.tenants t ON t.id=c.tenant_id JOIN app.stores st ON st.id=c.store_id").Where("c.id=?", item.ID).Take(&names).Error; err != nil {
			return err
		}
		raw, err := canonical(caseTerms{Schema: "mobile-tracer/case-start/v1", Case: item, Vehicle: vehicle, Terms: in.Terms, CustomerID: customer.ID, ActorID: a.User.ID, Deadline: in.Deadline, CompanyName: names.CompanyName, StoreName: names.StoreName})
		if err != nil {
			return err
		}
		var next int
		if err = tx.Table("app.case_start_requests").Select("COALESCE(max(version_no),0)+1").Where("case_id=?", item.ID).Scan(&next).Error; err != nil {
			return err
		}
		if err = tx.Raw(`INSERT INTO app.case_start_requests(case_id,version_no,customer_id,actor_id,terms,terms_hash,deadline,request_key) VALUES(?,?,?,?,?,?,?,?) RETURNING *`, item.ID, next, customer.ID, a.User.ID, raw, digest(string(raw)), in.Deadline, in.RequestKey).Scan(&result).Error; err != nil {
			return err
		}
		return workflowAudit(c.Request().Context(), tx, a.User, "case.start.present", "case", item.ID, map[string]any{"request_id": result.ID, "customer_id": customer.ID})
	})
	if e != nil {
		return e
	}
	return c.JSON(201, map[string]any{"data": result})
}
func validCaseDeadline(t time.Time) bool {
	return t.After(time.Now()) && t.Before(time.Now().Add(365*24*time.Hour))
}
func (s *Service) respondCaseStart(c *echo.Context) error {
	a := c.Get("workflow.actor").(Authenticated)
	var in struct {
		Decision string `json:"decision"`
	}
	if e := decodeJSON(c.Request(), &in); e != nil {
		return e
	}
	if in.Decision != "approved" && in.Decision != "rejected" && in.Decision != "held" {
		return business.Invalid("decision", "回答を選択してください。")
	}
	e := s.db.WithContext(c.Request().Context()).Transaction(func(tx *gorm.DB) error {
		var q caseStart
		if err := tx.Table("app.case_start_requests").Where("id=? AND customer_id=?", c.Param("requestID"), a.User.ID).Take(&q).Error; err != nil {
			return err
		}
		item, _, err := s.caseworkAccess(c, tx, q.CaseID, true)
		if err != nil {
			return err
		}
		latest, err := latestCaseStart(tx, q.CaseID)
		if err != nil {
			return err
		}
		if latest.ID != q.ID {
			return business.Conflict("新しい案件条件が提示されています。")
		}
		var old struct{ Decision string }
		err = tx.Table("app.case_start_responses").Where("request_id=?", q.ID).Take(&old).Error
		if err == nil {
			if old.Decision == in.Decision {
				return nil
			}
			return business.Conflict("回答済みの条件は変更できません。")
		}
		if err != gorm.ErrRecordNotFound {
			return err
		}
		if item.Status != "awaiting_customer" || !time.Now().Before(q.Deadline) {
			return business.Conflict("開始承認待ちではないか、期限を過ぎています。")
		}
		if err = tx.Table("app.case_start_responses").Create(map[string]any{"request_id": q.ID, "actor_id": a.User.ID, "decision": in.Decision}).Error; err != nil {
			return err
		}
		if in.Decision == "approved" {
			if err = tx.Table("app.cases").Where("id=?", q.CaseID).Update("status", "in_progress").Error; err != nil {
				return err
			}
			if err = queueCaseStart(tx, q.ID); err != nil {
				return err
			}
		}
		return workflowAudit(c.Request().Context(), tx, a.User, "case.start.respond", "case", q.CaseID, map[string]any{"request_id": q.ID, "decision": in.Decision})
	})
	if e != nil {
		return e
	}
	return c.JSON(200, map[string]any{"data": "saved"})
}
func queueCaseStart(tx *gorm.DB, id string) error {
	var q caseStart
	if e := tx.Table("app.case_start_requests").Where("id=?", id).Take(&q).Error; e != nil {
		return e
	}
	var response struct {
		ActorID   string
		Decision  string
		CreatedAt time.Time
	}
	if e := tx.Table("app.case_start_responses").Where("request_id=?", id).Take(&response).Error; e != nil {
		return e
	}
	content, err := decodeCanonical(q.Terms)
	if err != nil {
		return err
	}
	return queueTimestamp(tx, "case_start", id, map[string]any{"schema": "mobile-tracer/case-acceptance/v1", "request_id": id, "case_id": q.CaseID, "terms": content, "approval": response})
}
func (s *Service) getCasework(c *echo.Context) error {
	db := s.db.WithContext(c.Request().Context())
	item, p, e := s.caseworkAccess(c, db, c.Param("caseID"), false)
	if e != nil {
		return e
	}
	start, e := latestCaseStart(db, item.ID)
	if e != nil {
		return e
	}
	var terms caseTerms
	if e = json.Unmarshal(start.Terms, &terms); e != nil {
		return e
	}
	events, e := caseEventViews(db, item.ID)
	if e != nil {
		return e
	}
	jobs := []apiRegistration{}
	if e = db.Table("integrity.api_registrations").Where("(subject_type='case_start' AND subject_id IN (SELECT id FROM app.case_start_requests WHERE case_id=?)) OR(subject_type IN ('event_approval','event_completion') AND subject_id IN (SELECT id FROM app.case_events WHERE case_id=?))", item.ID, item.ID).Order("updated_at").Find(&jobs).Error; e != nil {
		return e
	}
	stages := []string{}
	if p != nil {
		stages, e = business.New(db).AllowedNextStages(c.Request().Context(), *p, item.ID)
		if e != nil {
			return e
		}
	}
	return c.JSON(200, map[string]any{"data": caseworkDocument{Case: item, Vehicle: terms.Vehicle, Start: start, Terms: terms, CanManage: p != nil && workflowWriteAllowed(*p, item), Events: events, Registrations: jobs, APIConfigured: s.timestampAPI != nil, NextStages: stages}})
}
func (s *Service) verifyCasework(c *echo.Context) error {
	if !business.ValidID(c.Param("registrationID")) {
		return business.NotFound()
	}
	db := s.db.WithContext(c.Request().Context())
	item, _, e := s.caseworkAccess(c, db, c.Param("caseID"), false)
	if e != nil {
		return e
	}
	var job apiRegistration
	if e = db.Table("integrity.api_registrations").Where("id=? AND ((subject_type='case_start' AND subject_id IN (SELECT id FROM app.case_start_requests WHERE case_id=?)) OR (subject_type IN ('event_approval','event_completion') AND subject_id IN (SELECT id FROM app.case_events WHERE case_id=?)))", c.Param("registrationID"), item.ID, item.ID).Take(&job).Error; e != nil {
		return e
	}
	result, e := s.verifyTimestamp(c.Request().Context(), job)
	if e != nil {
		return e
	}
	expected, e := caseworkManifest(db, job.SubjectType, job.SubjectID)
	if e != nil {
		return e
	}
	raw, e := canonical(expected)
	if e != nil {
		return e
	}
	if result == "match" && digest(string(raw)) != job.ManifestHash {
		result = "mismatch"
	}
	a := c.Get("workflow.actor").(Authenticated)
	if e = s.db.Transaction(func(tx *gorm.DB) error {
		return workflowAudit(c.Request().Context(), tx, a.User, "case.verify", "case", item.ID, map[string]any{"registration_id": job.ID, "result": result})
	}); e != nil {
		return e
	}
	return c.JSON(200, map[string]any{"data": map[string]string{"result": result}})
}
