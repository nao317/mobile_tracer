package authn

import (
	"bytes"
	"encoding/json"
	"net/mail"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/nao317/mobile_tracer/backend/internal/business"
)

type ManagedUser struct {
	ID            string    `json:"id"`
	Email         string    `json:"email"`
	EmailVerified bool      `json:"email_verified"`
	DisplayName   string    `json:"display_name"`
	AccountType   string    `json:"account_type"`
	Status        string    `json:"status"`
	Version       int       `json:"version"`
	CreatedAt     time.Time `json:"created_at"`
}
type CompanyProfile struct {
	LegalName     string   `json:"legal_name"`
	Description   string   `json:"description"`
	Website       string   `json:"website"`
	Phone         string   `json:"phone"`
	Address       string   `json:"address"`
	ContactEmail  string   `json:"contact_email"`
	BusinessTypes []string `json:"business_types"`
}
type Company struct {
	ID         string          `json:"id"`
	Name       string          `json:"name"`
	Status     string          `json:"status"`
	Profile    CompanyProfile  `json:"profile" gorm:"-"`
	Version    int             `json:"version"`
	CreatedAt  time.Time       `json:"created_at"`
	RawProfile json.RawMessage `json:"-" gorm:"column:profile"`
}
type ManagementRequest struct {
	ID             string          `json:"id"`
	RequesterID    string          `json:"requester_id"`
	RequesterEmail string          `json:"requester_email" gorm:"->"`
	DeciderEmail   string          `json:"decider_email" gorm:"->"`
	RequestKey     string          `json:"request_key"`
	Kind           string          `json:"kind"`
	CompanyID      *string         `json:"company_id"`
	Payload        json.RawMessage `json:"payload"`
	Status         string          `json:"status"`
	CreatedAt      time.Time       `json:"created_at"`
	DecidedBy      *string         `json:"decided_by"`
	DecidedAt      *time.Time      `json:"decided_at"`
	DecisionReason string          `json:"decision_reason"`
}
type CompanyInput struct {
	Name    string         `json:"name"`
	Profile CompanyProfile `json:"profile"`
	Version *int           `json:"version,omitempty"`
}
type UpgradeInput struct {
	DisplayName string `json:"display_name"`
	Reason      string `json:"reason"`
}
type CreateRequestInput struct {
	Kind       string          `json:"kind"`
	CompanyID  *string         `json:"company_id"`
	RequestKey string          `json:"request_key"`
	Payload    json.RawMessage `json:"payload"`
}
type CompanyMember struct {
	ID          string     `json:"id"`
	UserID      string     `json:"user_id"`
	StaffID     string     `json:"staff_id"`
	DisplayName string     `json:"display_name"`
	Email       string     `json:"email"`
	Role        string     `json:"role"`
	RevokedAt   *time.Time `json:"revoked_at"`
}
type ManagedPage[T any] struct {
	Data       []T                 `json:"data"`
	Pagination business.Pagination `json:"pagination"`
}

func validText(field, value string, max int, required bool) error {
	if utf8.RuneCountInString(value) > max || required && strings.TrimSpace(value) == "" {
		return business.Invalid(field, "文字数と必須項目を確認してください。")
	}
	return nil
}
func validateCompany(in CompanyInput, versionRequired bool) error {
	if err := validText("name", in.Name, 200, true); err != nil {
		return err
	}
	for _, f := range []struct {
		name, value string
		max         int
		required    bool
	}{
		{"legal_name", in.Profile.LegalName, 200, true}, {"description", in.Profile.Description, 4000, false}, {"phone", in.Profile.Phone, 100, false}, {"address", in.Profile.Address, 1000, false}, {"website", in.Profile.Website, 2000, false}, {"contact_email", in.Profile.ContactEmail, 320, false},
	} {
		if err := validText("profile."+f.name, f.value, f.max, f.required); err != nil {
			return err
		}
	}
	if in.Profile.Website != "" {
		u, err := url.Parse(in.Profile.Website)
		if err != nil || u.Host == "" || u.User != nil || (u.Scheme != "https" && u.Scheme != "http") {
			return business.Invalid("profile.website", "HTTP(S)のURLを指定してください。")
		}
	}
	if in.Profile.ContactEmail != "" {
		v, err := mail.ParseAddress(in.Profile.ContactEmail)
		if err != nil || v.Address != in.Profile.ContactEmail {
			return business.Invalid("profile.contact_email", "メールアドレスを確認してください。")
		}
	}
	seen := map[string]bool{}
	if len(in.Profile.BusinessTypes) == 0 || len(in.Profile.BusinessTypes) > 3 {
		return business.Invalid("profile.business_types", "業態を1つ以上選択してください。")
	}
	for _, kind := range in.Profile.BusinessTypes {
		if seen[kind] || kind != "rental" && kind != "dealer" && kind != "repair" {
			return business.Invalid("profile.business_types", "業態を確認してください。")
		}
		seen[kind] = true
	}
	if versionRequired && (in.Version == nil || *in.Version < 0) {
		return business.Invalid("version", "取得した版番号を指定してください。")
	}
	return nil
}
func requestPayload(in CreateRequestInput) (json.RawMessage, error) {
	if !business.ValidID(in.RequestKey) {
		return nil, business.Invalid("request_key", "申請キーを確認してください。")
	}
	if in.CompanyID != nil && !business.ValidID(*in.CompanyID) {
		return nil, business.Invalid("company_id", "企業を確認してください。")
	}
	decoder := json.NewDecoder(bytes.NewReader(in.Payload))
	decoder.DisallowUnknownFields()
	var value any
	switch in.Kind {
	case "business_upgrade":
		if in.CompanyID != nil {
			return nil, business.Invalid("company_id", "業者変更申請に企業は指定できません。")
		}
		var payload UpgradeInput
		if err := decoder.Decode(&payload); err != nil {
			return nil, business.Invalid("payload", "申請内容を確認してください。")
		}
		if err := validText("display_name", payload.DisplayName, 200, true); err != nil {
			return nil, err
		}
		if err := validText("reason", payload.Reason, 2000, true); err != nil {
			return nil, err
		}
		value = payload
	case "company_create", "company_profile_update":
		if in.Kind == "company_create" && in.CompanyID != nil || in.Kind == "company_profile_update" && in.CompanyID == nil {
			return nil, business.Invalid("company_id", "対象企業を確認してください。")
		}
		var payload CompanyInput
		if err := decoder.Decode(&payload); err != nil {
			return nil, business.Invalid("payload", "企業・プロファイルの内容を確認してください。")
		}
		if err := validateCompany(payload, in.Kind == "company_profile_update"); err != nil {
			return nil, err
		}
		value = payload
	default:
		return nil, business.Invalid("kind", "申請種別を確認してください。")
	}
	canonical, err := json.Marshal(value)
	return canonical, err
}
