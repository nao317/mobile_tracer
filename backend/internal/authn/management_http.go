package authn

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/labstack/echo/v5"
	"github.com/nao317/mobile_tracer/backend/internal/business"
	"gorm.io/gorm"
)

const managementActorKey = "management.actor"

func managementActor(c *echo.Context) Authenticated { return c.Get(managementActorKey).(Authenticated) }
func managementID(c *echo.Context, key string) (string, error) {
	id := c.Param(key)
	if !business.ValidID(id) {
		return "", business.Invalid(key, "対象を確認してください。")
	}
	return id, nil
}
func managementPage(c *echo.Context) (int, int, error) {
	page, size := 1, 20
	var err error
	if value := c.QueryParam("page"); value != "" {
		page, err = strconv.Atoi(value)
		if err != nil || page < 1 || page > 1000000 {
			return 0, 0, business.Invalid("page", "ページを確認してください。")
		}
	}
	if value := c.QueryParam("page_size"); value != "" {
		size, err = strconv.Atoi(value)
		if err != nil || size < 1 || size > 100 {
			return 0, 0, business.Invalid("page_size", "件数は1〜100を指定してください。")
		}
	}
	for key, values := range c.QueryParams() {
		if len(values) != 1 {
			return 0, 0, business.Invalid(key, "条件は1つずつ指定してください。")
		}
		if key != "page" && key != "page_size" && key != "q" && key != "status" && key != "kind" && key != "account_type" {
			return 0, 0, business.Invalid(key, "未対応の検索条件です。")
		}
	}
	if err := validText("q", c.QueryParam("q"), 200, false); err != nil {
		return 0, 0, err
	}
	return page, size, nil
}
func likeQuery(value string) string {
	value = strings.ReplaceAll(value, "\\", "\\\\")
	value = strings.ReplaceAll(value, "%", "\\%")
	value = strings.ReplaceAll(value, "_", "\\_")
	return "%" + value + "%"
}
func listPage[T any](c *echo.Context, query *gorm.DB, order string) (ManagedPage[T], error) {
	page, size, err := managementPage(c)
	if err != nil {
		return ManagedPage[T]{}, err
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return ManagedPage[T]{}, err
	}
	items := []T{}
	if err := query.Order(order).Limit(size).Offset((page - 1) * size).Find(&items).Error; err != nil {
		return ManagedPage[T]{}, err
	}
	return ManagedPage[T]{Data: items, Pagination: business.Pagination{Page: page, PageSize: size, Total: total}}, nil
}

func (s *Service) registerManagement(e *echo.Echo) {
	group := func(prefix string, admin bool) *echo.Group {
		return e.Group(prefix, func(next echo.HandlerFunc) echo.HandlerFunc {
			return func(c *echo.Context) error {
				c.Response().Header().Set("Cache-Control", "no-store")
				c.Response().Header().Set("Referrer-Policy", "no-referrer")
				ctx, cancel := context.WithTimeout(c.Request().Context(), 15*time.Second)
				defer cancel()
				c.SetRequest(c.Request().WithContext(ctx))
				c.Request().Body = http.MaxBytesReader(c.Response(), c.Request().Body, 65536)
				actor, err := s.Authenticate(c.Request())
				if err != nil {
					return err
				}
				if admin && !s.admin(actor.User) {
					return business.Forbidden()
				}
				if !safe(c.Request().Method) {
					if err := s.csrf(c.Request(), actor.Session); err != nil {
						return err
					}
				}
				c.Set(managementActorKey, actor)
				return next(c)
			}
		})
	}
	me := group("/api/me", false)
	me.GET("/history", s.listTransactionHistory)
	admin := group("/api/admin", true)
	me.GET("/requests", func(c *echo.Context) error { return s.listRequests(c, managementActor(c).User.ID) })
	me.POST("/requests", func(c *echo.Context) error {
		var input CreateRequestInput
		if err := decodeJSON(c.Request(), &input); err != nil {
			return err
		}
		request, err := s.createRequest(c.Request().Context(), managementActor(c).User, input)
		if err != nil {
			return err
		}
		return c.JSON(201, map[string]any{"data": request})
	})
	me.GET("/companies", func(c *echo.Context) error {
		items, err := ownCompanies(s.db.WithContext(c.Request().Context()), managementActor(c).User.ID)
		if err != nil {
			return err
		}
		return c.JSON(200, map[string]any{"data": items})
	})
	admin.GET("/overview", func(c *echo.Context) error {
		db := s.db.WithContext(c.Request().Context())
		counts := map[string]int64{}
		for _, item := range []struct{ key, table, condition string }{{"users", "auth.users", ""}, {"business_users", "auth.users", "account_type='business'"}, {"companies", "app.tenants", ""}, {"pending_requests", "auth.management_requests", "status='pending'"}} {
			query := db.Table(item.table)
			if item.condition != "" {
				query = query.Where(item.condition)
			}
			var count int64
			if err := query.Count(&count).Error; err != nil {
				return err
			}
			counts[item.key] = count
		}
		return c.JSON(200, map[string]any{"data": counts})
	})
	admin.GET("/users", s.listManagedUsers)
	admin.GET("/users/:userID", func(c *echo.Context) error {
		id, err := managementID(c, "userID")
		if err != nil {
			return err
		}
		db := s.db.WithContext(c.Request().Context())
		user, err := managedUser(db, id)
		if err != nil {
			return err
		}
		companies, err := ownCompanies(db, id)
		if err != nil {
			return err
		}
		return c.JSON(200, map[string]any{"data": map[string]any{"user": user, "companies": companies}})
	})
	admin.PATCH("/users/:userID", func(c *echo.Context) error {
		id, err := managementID(c, "userID")
		if err != nil {
			return err
		}
		var input struct {
			DisplayName string `json:"display_name"`
			AccountType string `json:"account_type"`
			Status      string `json:"status"`
			Version     *int   `json:"version"`
		}
		if err := decodeJSON(c.Request(), &input); err != nil {
			return err
		}
		if input.Version == nil || *input.Version < 0 {
			return business.Invalid("version", "版番号を指定してください。")
		}
		if err := s.updateManagedUser(c.Request().Context(), managementActor(c).User, id, ManagedUser{DisplayName: input.DisplayName, AccountType: input.AccountType, Status: input.Status, Version: *input.Version}); err != nil {
			return err
		}
		user, err := managedUser(s.db.WithContext(c.Request().Context()), id)
		if err != nil {
			return err
		}
		return c.JSON(200, map[string]any{"data": user})
	})
	admin.GET("/companies", s.listManagedCompanies)
	admin.GET("/companies/:companyID", func(c *echo.Context) error {
		id, err := managementID(c, "companyID")
		if err != nil {
			return err
		}
		db := s.db.WithContext(c.Request().Context())
		company, err := getCompany(db, id)
		if err != nil {
			return err
		}
		members, err := companyMembers(db, id)
		if err != nil {
			return err
		}
		return c.JSON(200, map[string]any{"data": map[string]any{"company": company, "members": members}})
	})
	admin.POST("/companies", func(c *echo.Context) error {
		var input struct {
			CompanyInput
			OwnerUserID string `json:"owner_user_id"`
		}
		if err := decodeJSON(c.Request(), &input); err != nil {
			return err
		}
		if !business.ValidID(input.OwnerUserID) {
			return business.Invalid("owner_user_id", "企業管理者となる業者ユーザーを選択してください。")
		}
		actor := managementActor(c).User
		var id string
		err := s.db.WithContext(c.Request().Context()).Transaction(func(tx *gorm.DB) error {
			owner, err := lockUser(tx, input.OwnerUserID)
			if err != nil {
				return err
			}
			id, err = createCompany(tx, actor, owner, input.CompanyInput)
			if err != nil {
				return err
			}
			return managementAudit(c.Request().Context(), tx, actor, "management.company_created", "tenant", id, map[string]any{"owner_user_id": owner.ID})
		})
		if err != nil {
			return err
		}
		company, err := getCompany(s.db.WithContext(c.Request().Context()), id)
		if err != nil {
			return err
		}
		return c.JSON(201, map[string]any{"data": company})
	})
	admin.PATCH("/companies/:companyID", func(c *echo.Context) error {
		id, err := managementID(c, "companyID")
		if err != nil {
			return err
		}
		var input struct {
			CompanyInput
			Status string `json:"status"`
		}
		if err := decodeJSON(c.Request(), &input); err != nil {
			return err
		}
		if input.Status != "active" && input.Status != "suspended" && input.Status != "provisioning" && input.Status != "closed" {
			return business.Invalid("status", "企業の状態を確認してください。")
		}
		actor := managementActor(c).User
		err = s.db.WithContext(c.Request().Context()).Transaction(func(tx *gorm.DB) error {
			if err := saveCompany(tx, id, input.CompanyInput, input.Status); err != nil {
				return err
			}
			return managementAudit(c.Request().Context(), tx, actor, "management.company_updated", "tenant", id, map[string]any{"status": input.Status, "version": *input.Version + 1})
		})
		if err != nil {
			return err
		}
		company, err := getCompany(s.db.WithContext(c.Request().Context()), id)
		if err != nil {
			return err
		}
		return c.JSON(200, map[string]any{"data": company})
	})
	admin.POST("/companies/:companyID/members", func(c *echo.Context) error {
		id, err := managementID(c, "companyID")
		if err != nil {
			return err
		}
		var input struct {
			UserID string `json:"user_id"`
			Role   string `json:"role"`
		}
		if err := decodeJSON(c.Request(), &input); err != nil {
			return err
		}
		if !business.ValidID(input.UserID) {
			return business.Invalid("user_id", "ユーザーを選択してください。")
		}
		actor := managementActor(c).User
		err = s.db.WithContext(c.Request().Context()).Transaction(func(tx *gorm.DB) error {
			user, err := lockUser(tx, input.UserID)
			if err != nil {
				return err
			}
			if err := lockCompany(tx, id); err != nil {
				return err
			}
			if err := addCompanyMember(tx, actor, id, user, input.Role); err != nil {
				return err
			}
			return managementAudit(c.Request().Context(), tx, actor, "management.membership_created", "tenant", id, map[string]any{"user_id": user.ID, "role": input.Role})
		})
		if err != nil {
			return err
		}
		return c.JSON(201, map[string]any{"data": map[string]string{"status": "created"}})
	})
	admin.POST("/companies/:companyID/members/:linkID/revoke", func(c *echo.Context) error {
		id, err := managementID(c, "companyID")
		if err != nil {
			return err
		}
		linkID, err := managementID(c, "linkID")
		if err != nil {
			return err
		}
		var input struct {
			Reason string `json:"reason"`
		}
		if err := decodeJSON(c.Request(), &input); err != nil {
			return err
		}
		if err := s.revokeMember(c.Request().Context(), managementActor(c).User, id, linkID, input.Reason); err != nil {
			return err
		}
		return c.JSON(200, map[string]any{"data": map[string]string{"status": "revoked"}})
	})
	admin.GET("/requests", func(c *echo.Context) error { return s.listRequests(c, "") })
	admin.POST("/requests/:requestID/decision", func(c *echo.Context) error {
		id, err := managementID(c, "requestID")
		if err != nil {
			return err
		}
		var input struct {
			Decision string `json:"decision"`
			Reason   string `json:"reason"`
		}
		if err := decodeJSON(c.Request(), &input); err != nil {
			return err
		}
		request, err := s.decideRequest(c.Request().Context(), managementActor(c).User, id, input.Decision, input.Reason)
		if err != nil {
			return err
		}
		return c.JSON(200, map[string]any{"data": request})
	})
}
func (s *Service) listManagedUsers(c *echo.Context) error {
	query := s.db.WithContext(c.Request().Context()).Table("auth.users")
	if q := c.QueryParam("q"); q != "" {
		pattern := likeQuery(q)
		query = query.Where("email ILIKE ? OR display_name ILIKE ?", pattern, pattern)
	}
	if kind := c.QueryParam("account_type"); kind != "" {
		if kind != "general" && kind != "business" {
			return business.Invalid("account_type", "区分を確認してください。")
		}
		query = query.Where("account_type=?", kind)
	}
	if status := c.QueryParam("status"); status != "" {
		if status != "active" && status != "suspended" {
			return business.Invalid("status", "状態を確認してください。")
		}
		query = query.Where("status=?", status)
	}
	page, err := listPage[ManagedUser](c, query, "created_at DESC,id")
	if err != nil {
		return err
	}
	return c.JSON(200, page)
}
func (s *Service) listManagedCompanies(c *echo.Context) error {
	query := companyQuery(s.db.WithContext(c.Request().Context()))
	if q := c.QueryParam("q"); q != "" {
		query = query.Where("t.name ILIKE ?", likeQuery(q))
	}
	if status := c.QueryParam("status"); status != "" {
		if status != "active" && status != "suspended" && status != "closed" && status != "provisioning" {
			return business.Invalid("status", "状態を確認してください。")
		}
		query = query.Where("t.status=?", status)
	}
	page, err := listPage[Company](c, query, "t.created_at DESC,t.id")
	if err != nil {
		return err
	}
	for i := range page.Data {
		if err := decodeCompany(&page.Data[i]); err != nil {
			return err
		}
	}
	return c.JSON(200, page)
}
func (s *Service) listRequests(c *echo.Context, requesterID string) error {
	query := requestSearch(s.db.WithContext(c.Request().Context()), requesterID)
	if status := c.QueryParam("status"); status != "" {
		if status != "pending" && status != "approved" && status != "rejected" {
			return business.Invalid("status", "審査状態を確認してください。")
		}
		query = query.Where("r.status=?", status)
	}
	if kind := c.QueryParam("kind"); kind != "" {
		if kind != "business_upgrade" && kind != "company_create" && kind != "company_profile_update" {
			return business.Invalid("kind", "申請種別を確認してください。")
		}
		query = query.Where("r.kind=?", kind)
	}
	if q := c.QueryParam("q"); q != "" {
		query = query.Where("u.email ILIKE ?", likeQuery(q))
	}
	page, err := listPage[ManagementRequest](c, query, "r.created_at DESC,r.id")
	if err != nil {
		return err
	}
	return c.JSON(200, page)
}
