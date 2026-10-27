package server

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/labstack/echo/v5"
	"github.com/nao317/mobile_tracer/backend/internal/business"
	"github.com/nao317/mobile_tracer/backend/internal/config"
)

const principalKey = "business.principal"

func RegisterBusiness(e *echo.Echo, service *business.Service, auth config.BusinessAuth) {
	previous := e.HTTPErrorHandler
	e.HTTPErrorHandler = func(c *echo.Context, err error) {
		if response, _ := echo.UnwrapResponse(c.Response()); response != nil && response.Committed {
			return
		}
		if c.Request().URL.Path != "/api" && !strings.HasPrefix(c.Request().URL.Path, "/api/") {
			previous(c, err)
			return
		}
		public := business.PublicError(err)
		c.Response().Header().Set("Cache-Control", "no-store")
		if code := echo.StatusCode(err); code >= 400 && code < 500 {
			var app *business.Error
			if !errors.As(err, &app) {
				public = &business.Error{Status: code, Code: strings.ToLower(strings.ReplaceAll(http.StatusText(code), " ", "_")), Message: http.StatusText(code), Fields: map[string][]string{}}
				if code == http.StatusRequestEntityTooLarge {
					public.Code = "payload_too_large"
					public.Message = "本文の上限は1 MiBです。"
				}
			}
		}
		if public.Status == 401 {
			c.Response().Header().Set("WWW-Authenticate", "Bearer")
		}
		_ = c.JSON(public.Status, map[string]any{"error": public})
	}
	group := e.Group("/api", func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c *echo.Context) error {
			c.Response().Header().Set("Cache-Control", "no-store")
			if auth.Environment != "development" || auth.Token == "" || !business.ValidID(auth.StaffID) {
				return business.Unauthorized()
			}
			header := c.Request().Header.Get("Authorization")
			parts := strings.Fields(header)
			if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || subtle.ConstantTimeCompare([]byte(parts[1]), []byte(auth.Token)) != 1 {
				return business.Unauthorized()
			}
			ctx, cancel := context.WithTimeout(c.Request().Context(), 10*time.Second)
			defer cancel()
			c.SetRequest(c.Request().WithContext(ctx))
			p, err := service.ResolveStaff(ctx, auth.StaffID)
			if err != nil {
				return err
			}
			c.Set(principalKey, p)
			if _, err := url.ParseQuery(c.Request().URL.RawQuery); err != nil {
				return business.Invalid("query", "クエリ文字列の形式が不正です。")
			}
			for _, name := range []string{"vehicleID", "caseID", "recordID", "versionID"} {
				if value := c.Param(name); value != "" && !business.ValidID(value) {
					return business.Invalid(name, "UUIDを指定してください。")
				}
			}
			c.Response().Header().Set("Cache-Control", "no-store")
			return next(c)
		}
	})
	principal := func(c *echo.Context) business.Principal { return c.Get(principalKey).(business.Principal) }
	id := func(c *echo.Context, key string) string { return strings.ToLower(c.Param(key)) }
	respond := func(c *echo.Context, status int, value any, err error) error {
		if err != nil {
			return err
		}
		return c.JSON(status, map[string]any{"data": value})
	}
	group.GET("/context", func(c *echo.Context) error {
		v, err := service.Context(c.Request().Context(), principal(c))
		return respond(c, 200, v, err)
	})
	group.GET("/vehicles", func(c *echo.Context) error {
		o, err := parseList(c.QueryParams(), "vehicles")
		if err != nil {
			return err
		}
		v, err := service.Vehicles(c.Request().Context(), principal(c), o)
		if err != nil {
			return err
		}
		return c.JSON(200, v)
	})
	group.POST("/vehicles", func(c *echo.Context) error {
		var in business.VehicleCreate
		if err := decodeBody(c, &in); err != nil {
			return err
		}
		v, err := service.CreateVehicle(c.Request().Context(), principal(c), in)
		return respond(c, 201, v, err)
	})
	group.GET("/vehicles/:vehicleID", func(c *echo.Context) error {
		v, err := service.Vehicle(c.Request().Context(), principal(c), id(c, "vehicleID"))
		return respond(c, 200, v, err)
	})
	group.PATCH("/vehicles/:vehicleID", func(c *echo.Context) error {
		var in business.VehiclePatch
		if err := decodeBody(c, &in); err != nil {
			return err
		}
		v, err := service.UpdateVehicle(c.Request().Context(), principal(c), id(c, "vehicleID"), in)
		return respond(c, 200, v, err)
	})
	group.GET("/cases", func(c *echo.Context) error {
		o, err := parseList(c.QueryParams(), "cases")
		if err != nil {
			return err
		}
		v, err := service.Cases(c.Request().Context(), principal(c), o)
		if err != nil {
			return err
		}
		return c.JSON(200, v)
	})
	group.POST("/cases", func(c *echo.Context) error {
		var in business.CaseCreate
		if err := decodeBody(c, &in); err != nil {
			return err
		}
		v, err := service.CreateCase(c.Request().Context(), principal(c), in)
		return respond(c, 201, v, err)
	})
	group.GET("/cases/:caseID", func(c *echo.Context) error {
		v, err := service.Case(c.Request().Context(), principal(c), id(c, "caseID"))
		return respond(c, 200, v, err)
	})
	group.PATCH("/cases/:caseID", func(c *echo.Context) error {
		var in business.CasePatch
		if err := decodeBody(c, &in); err != nil {
			return err
		}
		v, err := service.UpdateCase(c.Request().Context(), principal(c), id(c, "caseID"), in)
		return respond(c, 200, v, err)
	})
	group.POST("/cases/:caseID/cancel", func(c *echo.Context) error {
		var in business.CancelCase
		if err := decodeBody(c, &in); err != nil {
			return err
		}
		v, err := service.CancelCase(c.Request().Context(), principal(c), id(c, "caseID"), in)
		return respond(c, 200, v, err)
	})
	group.GET("/cases/:caseID/records", func(c *echo.Context) error {
		o, err := parseList(c.QueryParams(), "records")
		if err != nil {
			return err
		}
		v, err := service.Records(c.Request().Context(), principal(c), id(c, "caseID"), o)
		if err != nil {
			return err
		}
		return c.JSON(200, v)
	})
	group.POST("/cases/:caseID/records", func(c *echo.Context) error {
		var in business.RecordCreate
		if err := decodeBody(c, &in); err != nil {
			return err
		}
		v, err := service.CreateRecord(c.Request().Context(), principal(c), id(c, "caseID"), in)
		return respond(c, 201, v, err)
	})
	group.GET("/cases/:caseID/records/:recordID", func(c *echo.Context) error {
		v, err := service.Record(c.Request().Context(), principal(c), id(c, "caseID"), id(c, "recordID"))
		return respond(c, 200, v, err)
	})
	group.GET("/cases/:caseID/records/:recordID/versions", func(c *echo.Context) error {
		o, err := parseList(c.QueryParams(), "versions")
		if err != nil {
			return err
		}
		v, err := service.Versions(c.Request().Context(), principal(c), id(c, "caseID"), id(c, "recordID"), o)
		if err != nil {
			return err
		}
		return c.JSON(200, v)
	})
	group.GET("/cases/:caseID/records/:recordID/versions/:versionID", func(c *echo.Context) error {
		v, err := service.Version(c.Request().Context(), principal(c), id(c, "caseID"), id(c, "recordID"), id(c, "versionID"))
		return respond(c, 200, v, err)
	})
	group.PUT("/cases/:caseID/records/:recordID/versions/:versionID/entries", func(c *echo.Context) error {
		var in business.DraftUpdate
		if err := decodeBody(c, &in); err != nil {
			return err
		}
		v, err := service.UpdateDraft(c.Request().Context(), principal(c), id(c, "caseID"), id(c, "recordID"), id(c, "versionID"), in)
		return respond(c, 200, v, err)
	})
}

func decodeBody(c *echo.Context, dest any) error {
	media, _, err := mime.ParseMediaType(c.Request().Header.Get("Content-Type"))
	if err != nil || media != "application/json" {
		return echo.ErrUnsupportedMediaType
	}
	raw, err := io.ReadAll(http.MaxBytesReader(c.Response(), c.Request().Body, 1<<20))
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			return echo.ErrStatusRequestEntityTooLarge
		}
		return business.Invalid("body", "JSONを読み取れません。")
	}
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 || raw[0] != '{' {
		return business.Invalid("body", "JSONオブジェクトを指定してください。")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dest); err != nil {
		return business.Invalid("body", "JSONの形式・項目名・型を確認してください。")
	}
	if decoder.Decode(new(any)) != io.EOF {
		return business.Invalid("body", "JSONオブジェクトを一つだけ指定してください。")
	}
	return nil
}

func parseList(query url.Values, kind string) (business.ListOptions, error) {
	o := business.ListOptions{Page: 1, PageSize: 20, Sort: "-created_at", Filters: map[string]string{}}
	sorts := []string{"created_at"}
	filters := []string{}
	switch kind {
	case "vehicles":
		sorts = append(sorts, "model_name")
	case "cases":
		filters = []string{"store_id", "vehicle_id", "assignee_id", "case_type", "status", "stage"}
		sorts = append(sorts, "stage")
	case "records":
		filters = []string{"record_kind"}
	case "versions":
		filters = []string{"status"}
		sorts = append(sorts, "version_no")
	}
	for key, values := range query {
		if len(values) != 1 || values[0] == "" {
			return o, business.Invalid(key, "値を一つ指定してください。")
		}
		value := values[0]
		switch key {
		case "page", "page_size":
			n, err := strconv.Atoi(value)
			if err != nil || n < 1 || key == "page_size" && n > 100 || key == "page" && n > 1000000 {
				return o, business.Invalid(key, "pageは1〜1000000、page_sizeは1〜100の整数を指定してください。")
			}
			if key == "page" {
				o.Page = n
			} else {
				o.PageSize = n
			}
		case "sort":
			if !slices.Contains(sorts, strings.TrimPrefix(value, "-")) {
				return o, business.Invalid(key, "対応している並び順を指定してください。")
			}
			o.Sort = value
		case "q":
			if kind != "vehicles" && kind != "cases" || utf8.RuneCountInString(value) > 200 || strings.TrimSpace(value) == "" {
				return o, business.Invalid(key, "検索文字列を200文字以内で指定してください。")
			}
			o.Query = value
		default:
			if !slices.Contains(filters, key) {
				return o, business.Invalid(key, "対応していないクエリパラメータです。")
			}
			if strings.HasSuffix(key, "_id") && !business.ValidID(value) {
				return o, business.Invalid(key, "UUIDを指定してください。")
			}
			if key == "case_type" && !slices.Contains([]string{"rental", "dealer", "repair"}, value) {
				return o, business.Invalid(key, "業態が不正です。")
			}
			if key == "status" {
				allowed := []string{"in_progress", "completed", "cancelled"}
				if kind == "versions" {
					allowed = []string{"draft", "submitted"}
				}
				if !slices.Contains(allowed, value) {
					return o, business.Invalid(key, "状態が不正です。")
				}
			}
			if utf8.RuneCountInString(value) > 100 {
				return o, business.Invalid(key, "100文字以内で指定してください。")
			}
			o.Filters[key] = value
		}
	}
	return o, nil
}
