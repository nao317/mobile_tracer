package authn

import (
	"strings"
	"time"

	"github.com/labstack/echo/v5"
	"github.com/nao317/mobile_tracer/backend/internal/business"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type caseEvent struct {
	ID            string    `json:"id"`
	CaseID        string    `json:"case_id"`
	ActorID       string    `json:"actor_id"`
	Origin        string    `json:"origin"`
	Kind          string    `json:"kind"`
	Title         string    `json:"title"`
	Description   string    `json:"description"`
	AmountMinor   *int64    `json:"amount_minor"`
	TargetStage   *string   `json:"target_stage"`
	Deadline      time.Time `json:"deadline"`
	SupersedesID  *string   `json:"supersedes_id"`
	ParentEventID *string   `json:"parent_event_id"`
	RequestKey    string    `json:"-"`
	CreatedAt     time.Time `json:"created_at"`
}
type caseEventAction struct {
	ID         string    `json:"id"`
	EventID    string    `json:"event_id"`
	ActorID    string    `json:"actor_id"`
	Action     string    `json:"action"`
	Detail     string    `json:"detail"`
	Sequence   int       `json:"sequence"`
	RequestKey string    `json:"-"`
	CreatedAt  time.Time `json:"created_at"`
}
type caseEventView struct {
	Event      caseEvent         `json:"event"`
	State      string            `json:"state"`
	Actions    []caseEventAction `json:"actions"`
	Superseded bool              `json:"superseded"`
}

func eventState(e caseEvent, actions []caseEventAction) string {
	if len(actions) == 0 {
		return "pending"
	}
	action := actions[len(actions)-1].Action
	switch action {
	case "executed":
		return "in_progress"
	case "reported":
		return "awaiting_completion"
	case "approved":
		if e.Kind == "progress_report" {
			return "completed"
		}
	}
	return action
}
func caseEventViews(db *gorm.DB, id string) ([]caseEventView, error) {
	events := []caseEvent{}
	if e := db.Table("app.case_events").Where("case_id=?", id).Order("created_at,id").Find(&events).Error; e != nil {
		return nil, e
	}
	rows := []caseEventView{}
	superseded := map[string]bool{}
	for _, e := range events {
		if e.SupersedesID != nil {
			superseded[*e.SupersedesID] = true
		}
	}
	for _, event := range events {
		actions := []caseEventAction{}
		if e := db.Table("app.case_event_actions").Where("event_id=?", event.ID).Order("sequence").Find(&actions).Error; e != nil {
			return nil, e
		}
		rows = append(rows, caseEventView{event, eventState(event, actions), actions, superseded[event.ID]})
	}
	return rows, nil
}
func (s *Service) createCaseEvent(c *echo.Context) error {
	a := c.Get("workflow.actor").(Authenticated)
	var in struct {
		Kind          string    `json:"kind"`
		Title         string    `json:"title"`
		Description   string    `json:"description"`
		AmountMinor   *int64    `json:"amount_minor"`
		TargetStage   *string   `json:"target_stage"`
		Deadline      time.Time `json:"deadline"`
		SupersedesID  *string   `json:"supersedes_id"`
		ParentEventID *string   `json:"parent_event_id"`
		RequestKey    string    `json:"request_key"`
	}
	if e := decodeJSON(c.Request(), &in); e != nil {
		return e
	}
	if !business.ValidID(in.RequestKey) || strings.TrimSpace(in.Title) == "" || len(in.Title) > 200 || strings.TrimSpace(in.Description) == "" || len(in.Description) > 8000 || !validCaseDeadline(in.Deadline) || (in.AmountMinor != nil && (*in.AmountMinor < 0 || *in.AmountMinor > 9007199254740991)) {
		return business.Invalid("event", "内容・金額・期限・再送キーを確認してください。")
	}
	for _, id := range []*string{in.ParentEventID, in.SupersedesID} {
		if id != nil && !business.ValidID(*id) {
			return business.Invalid("event", "関連するイベントを確認してください。")
		}
	}
	in.Deadline = in.Deadline.UTC().Truncate(time.Microsecond)
	var result caseEvent
	e := s.db.WithContext(c.Request().Context()).Transaction(func(tx *gorm.DB) error {
		item, p, err := s.caseworkAccess(c, tx, c.Param("caseID"), true)
		if err != nil {
			return err
		}
		if item.Status != "in_progress" {
			return business.Conflict("顧客が開始承認した進行中の案件だけ起票できます。")
		}
		origin := "customer"
		if p != nil {
			if !workflowWriteAllowed(*p, item) {
				return business.Forbidden()
			}
			origin = "business"
		}
		if origin == "business" && (in.Kind != "work" && in.Kind != "progress_report") || origin == "customer" && (in.Kind != "incident" && in.Kind != "request") {
			return business.Forbidden()
		}
		if in.Kind != "work" && (in.AmountMinor != nil || in.TargetStage != nil) {
			return business.Invalid("event", "金額・段階変更は作業提案として提示してください。")
		}
		err = tx.Table("app.case_events").Where("request_key=?", in.RequestKey).Take(&result).Error
		if err == nil {
			if result.CaseID != item.ID || result.ActorID != a.User.ID {
				return business.NotFound()
			}
			expected := caseEvent{CaseID: item.ID, ActorID: a.User.ID, Origin: origin, Kind: in.Kind, Title: in.Title, Description: in.Description, AmountMinor: in.AmountMinor, TargetStage: in.TargetStage, Deadline: in.Deadline, SupersedesID: in.SupersedesID, ParentEventID: in.ParentEventID}
			if !sameEvent(result, expected) {
				return business.Conflict("再送キーの内容が異なります。")
			}
			return nil
		}
		if err != gorm.ErrRecordNotFound {
			return err
		}
		if in.TargetStage != nil {
			if p == nil {
				return business.Forbidden()
			}
			if err = business.New(tx).ValidateStageTransition(c.Request().Context(), *p, item.ID, *in.TargetStage); err != nil {
				return err
			}
		}
		for _, linked := range []*string{in.ParentEventID, in.SupersedesID} {
			if linked != nil {
				var old caseEvent
				if err = tx.Table("app.case_events").Where("id=? AND case_id=?", *linked, item.ID).Take(&old).Error; err != nil {
					return err
				}
				if linked == in.SupersedesID {
					if old.ActorID != a.User.ID || old.Kind != in.Kind {
						return business.Forbidden()
					}
					actions := []caseEventAction{}
					if err = tx.Table("app.case_event_actions").Where("event_id=?", old.ID).Order("sequence").Find(&actions).Error; err != nil {
						return err
					}
					st := eventState(old, actions)
					if st != "pending" && st != "rejected" && st != "held" && st != "returned" {
						return business.Conflict("実行・承認済みの内容は置き換えられません。追加の提案を作成してください。")
					}
					var n int64
					if err = tx.Table("app.case_events").Where("supersedes_id=?", old.ID).Count(&n).Error; err != nil {
						return err
					}
					if n > 0 {
						return business.Conflict("すでに新版があります。")
					}
				}
			}
		}

		err = tx.Raw(`INSERT INTO app.case_events(case_id,actor_id,origin,kind,title,description,amount_minor,target_stage,deadline,supersedes_id,parent_event_id,request_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *`, item.ID, a.User.ID, origin, in.Kind, in.Title, in.Description, in.AmountMinor, in.TargetStage, in.Deadline, in.SupersedesID, in.ParentEventID, in.RequestKey).Scan(&result).Error
		if err != nil {
			return err
		}
		return workflowAudit(c.Request().Context(), tx, a.User, "case.event.create", "case", item.ID, map[string]any{"event_id": result.ID, "kind": in.Kind, "origin": origin})
	})
	if e != nil {
		return e
	}
	return c.JSON(201, map[string]any{"data": result})
}
func sameEvent(a, b caseEvent) bool {
	a.ID = ""
	a.RequestKey = ""
	a.CreatedAt = time.Time{}
	b.ID = ""
	b.RequestKey = ""
	b.CreatedAt = time.Time{}
	left, _ := canonical(a)
	right, _ := canonical(b)
	return string(left) == string(right)
}
func (s *Service) actCaseEvent(c *echo.Context) error {
	a := c.Get("workflow.actor").(Authenticated)
	var in struct {
		Action     string `json:"action"`
		Detail     string `json:"detail"`
		RequestKey string `json:"request_key"`
	}
	if e := decodeJSON(c.Request(), &in); e != nil {
		return e
	}
	if !business.ValidID(in.RequestKey) || len(in.Detail) > 8000 {
		return business.Invalid("action", "回答と再送キーを確認してください。")
	}
	e := s.db.WithContext(c.Request().Context()).Transaction(func(tx *gorm.DB) error {
		item, p, err := s.caseworkAccess(c, tx, c.Param("caseID"), true)
		if err != nil {
			return err
		}
		if item.Status != "in_progress" {
			return business.Conflict("進行中の案件ではありません。")
		}
		manage := p != nil && workflowWriteAllowed(*p, item)
		customer := p == nil
		var event caseEvent
		if err = tx.Table("app.case_events").Clauses(clause.Locking{Strength: "UPDATE"}).Where("id=? AND case_id=?", c.Param("eventID"), item.ID).Take(&event).Error; err != nil {
			return err
		}
		var existing caseEventAction
		err = tx.Table("app.case_event_actions").Where("request_key=?", in.RequestKey).Take(&existing).Error
		if err == nil {
			if existing.EventID != event.ID || existing.ActorID != a.User.ID {
				return business.NotFound()
			}
			if existing.Action != in.Action || existing.Detail != in.Detail {
				return business.Conflict("再送キーの内容が異なります。")
			}
			return nil
		}
		if err != gorm.ErrRecordNotFound {
			return err
		}
		var n int64
		if err = tx.Table("app.case_events").Where("supersedes_id=?", event.ID).Count(&n).Error; err != nil {
			return err
		}
		if n > 0 {
			return business.Conflict("新版への回答が必要です。")
		}
		actions := []caseEventAction{}
		if err = tx.Table("app.case_event_actions").Where("event_id=?", event.ID).Order("sequence").Find(&actions).Error; err != nil {
			return err
		}
		state := eventState(event, actions)
		review := in.Action == "approved" || in.Action == "rejected" || in.Action == "held" || in.Action == "returned"
		if review {
			if state != "pending" {
				return business.Conflict("回答済みです。再提示には新しい版を作成してください。")
			}
			if !time.Now().Before(event.Deadline) {
				return business.Conflict("回答期限を過ぎています。")
			}
			if event.Origin == "business" && !customer || event.Origin == "customer" && !manage || event.ActorID == a.User.ID {
				return business.Forbidden()
			}
			if in.Action == "returned" && strings.TrimSpace(in.Detail) == "" {
				return business.Invalid("detail", "差戻し理由を入力してください。")
			}
		} else {
			switch in.Action {
			case "executed":
				if !manage {
					return business.Forbidden()
				}
				if state != "approved" || event.Kind == "progress_report" {
					return business.Conflict("承認済みの作業・依頼だけ着手できます。")
				}
				if event.Kind == "work" && event.TargetStage != nil {
					if err = business.New(tx).ValidateStageTransition(c.Request().Context(), *p, item.ID, *event.TargetStage); err != nil {
						return err
					}
				}
			case "reported":
				if !manage {
					return business.Forbidden()
				}
				if state != "in_progress" {
					return business.Conflict("着手後に結果を報告してください。")
				}
				if strings.TrimSpace(in.Detail) == "" {
					return business.Invalid("detail", "対応結果を入力してください。")
				}
			case "completed":
				if !customer {
					return business.Forbidden()
				}
				if state != "awaiting_completion" {
					return business.Conflict("結果報告後に完了を確認してください。")
				}
			default:
				return business.Invalid("action", "対応操作を確認してください。")
			}
		}
		if err = tx.Table("app.case_event_actions").Create(map[string]any{"event_id": event.ID, "actor_id": a.User.ID, "action": in.Action, "detail": in.Detail, "request_key": in.RequestKey, "sequence": len(actions) + 1}).Error; err != nil {
			return err
		}
		if in.Action == "executed" && event.TargetStage != nil {
			if err = tx.Table("app.case_stage_executions").Create(map[string]any{"event_id": event.ID, "case_id": item.ID, "from_stage": item.Stage, "to_stage": *event.TargetStage}).Error; err != nil {
				return err
			}
			if err = tx.Table("app.cases").Where("id=?", item.ID).Update("stage", *event.TargetStage).Error; err != nil {
				return err
			}
		}
		if in.Action == "approved" {
			if err = queueCaseEvent(tx, event.ID, "event_approval"); err != nil {
				return err
			}
		}
		if in.Action == "completed" {
			if err = queueCaseEvent(tx, event.ID, "event_completion"); err != nil {
				return err
			}
		}
		return workflowAudit(c.Request().Context(), tx, a.User, "case.event."+in.Action, "case", item.ID, map[string]any{"event_id": event.ID, "detail": in.Detail})
	})
	if e != nil {
		return e
	}
	return c.JSON(200, map[string]any{"data": "saved"})
}
func queueCaseEvent(tx *gorm.DB, id, kind string) error {
	m, e := caseworkManifest(tx, kind, id)
	if e != nil {
		return e
	}
	return queueTimestamp(tx, kind, id, m)
}
func caseworkManifest(db *gorm.DB, kind, id string) (any, error) {
	if kind == "case_start" {
		var q caseStart
		if e := db.Table("app.case_start_requests").Where("id=?", id).Take(&q).Error; e != nil {
			return nil, e
		}
		var response struct {
			ActorID   string
			Decision  string
			CreatedAt time.Time
		}
		if e := db.Table("app.case_start_responses").Where("request_id=?", id).Take(&response).Error; e != nil {
			return nil, e
		}
		content, e := decodeCanonical(q.Terms)
		if e != nil {
			return nil, e
		}
		return map[string]any{"schema": "mobile-tracer/case-acceptance/v1", "request_id": id, "case_id": q.CaseID, "terms": content, "approval": response}, nil
	}
	var event caseEvent
	if e := db.Table("app.case_events").Where("id=?", id).Take(&event).Error; e != nil {
		return nil, e
	}
	actions := []caseEventAction{}
	q := db.Table("app.case_event_actions").Where("event_id=?", id)
	if kind == "event_approval" {
		q = q.Where("sequence=1")
	}
	if e := q.Order("sequence").Find(&actions).Error; e != nil {
		return nil, e
	}
	return map[string]any{"schema": "mobile-tracer/case-event/v1", "subject_type": kind, "event": event, "actions": actions}, nil
}
