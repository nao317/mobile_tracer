// Package business implements tenant-scoped vehicle, case and draft operations.
package business

import (
	"encoding/json"
	"time"
)

// Optional distinguishes an omitted PATCH property from an explicit JSON null.
type Optional[T any] struct {
	Set   bool
	Value *T
}

func (f *Optional[T]) UnmarshalJSON(data []byte) error {
	f.Set = true
	return json.Unmarshal(data, &f.Value)
}

type Principal struct {
	TenantID string `json:"tenant_id"`
	StaffID  string `json:"staff_id"`
	Roles    []Role `json:"roles"`
}

type Role struct {
	Role    string  `json:"role"`
	StoreID *string `json:"store_id"`
}

type IdentifierInput struct {
	Kind  string `json:"kind"`
	Value string `json:"value"`
}

type VehicleCreate struct {
	ModelName   *string           `json:"model_name"`
	Identifiers []IdentifierInput `json:"identifiers"`
}

type VehiclePatch struct {
	ModelName Optional[string] `json:"model_name"`
}

type Vehicle struct {
	ID          string       `json:"id"`
	ModelName   *string      `json:"model_name"`
	CreatedAt   time.Time    `json:"created_at"`
	Identifiers []Identifier `json:"identifiers"`
}

type Identifier struct {
	ID         string     `json:"id"`
	Kind       string     `json:"kind"`
	Value      string     `json:"value"`
	ValidFrom  *time.Time `json:"valid_from"`
	ValidTo    *time.Time `json:"valid_to"`
	VerifiedAt *time.Time `json:"verified_at"`
}

type CaseCreate struct {
	StoreID                string  `json:"store_id"`
	VehicleID              string  `json:"vehicle_id"`
	CaseType               string  `json:"case_type"`
	ConfigurationVersionID string  `json:"configuration_version_id"`
	AssigneeID             *string `json:"assignee_id"`
}

type CasePatch struct {
	AssigneeID Optional[string] `json:"assignee_id"`
	Stage      Optional[string] `json:"stage"`
}

type Case struct {
	ID                     string     `json:"id"`
	StoreID                string     `json:"store_id"`
	VehicleID              string     `json:"vehicle_id"`
	CaseType               string     `json:"case_type"`
	ConfigurationVersionID string     `json:"configuration_version_id"`
	AssigneeID             *string    `json:"assignee_id"`
	Stage                  string     `json:"stage"`
	Status                 string     `json:"status"`
	CancelReason           *string    `json:"cancel_reason"`
	CancelledBy            *string    `json:"cancelled_by"`
	CancelledAt            *time.Time `json:"cancelled_at"`
	CreatedBy              string     `json:"created_by"`
	CreatedAt              time.Time  `json:"created_at"`
}

type CancelCase struct {
	Reason string `json:"reason"`
}

type RecordCreate struct {
	RecordKind string                     `json:"record_kind"`
	Entries    map[string]json.RawMessage `json:"entries"`
}

type Record struct {
	ID         string    `json:"id"`
	CaseID     string    `json:"case_id"`
	RecordKind string    `json:"record_kind"`
	CreatedBy  string    `json:"created_by"`
	CreatedAt  time.Time `json:"created_at"`
}

type RecordCreated struct {
	Record Record  `json:"record"`
	Draft  Version `json:"draft"`
}

type Version struct {
	ID                     string                     `json:"id"`
	CaseID                 string                     `json:"case_id"`
	RecordID               string                     `json:"record_id"`
	VersionNo              int                        `json:"version_no"`
	Status                 string                     `json:"status"`
	ConfigurationVersionID string                     `json:"configuration_version_id"`
	LockVersion            int                        `json:"lock_version"`
	BasedOnVersionID       *string                    `json:"based_on_version_id"`
	ChangeKind             *string                    `json:"change_kind"`
	ChangeReason           *string                    `json:"change_reason"`
	SubmittedBy            *string                    `json:"submitted_by"`
	SubmittedAt            *time.Time                 `json:"submitted_at"`
	ContentHash            *string                    `json:"content_hash"`
	HashAlgorithm          *string                    `json:"hash_algorithm"`
	VehicleSnapshot        json.RawMessage            `json:"vehicle_snapshot"`
	CreatedBy              string                     `json:"created_by"`
	CreatedAt              time.Time                  `json:"created_at"`
	Entries                map[string]json.RawMessage `json:"entries"`
}

type DraftUpdate struct {
	LockVersion *int                       `json:"lock_version"`
	Entries     map[string]json.RawMessage `json:"entries"`
}

type Pagination struct {
	Page     int   `json:"page"`
	PageSize int   `json:"page_size"`
	Total    int64 `json:"total"`
}

type Page[T any] struct {
	Data       []T        `json:"data"`
	Pagination Pagination `json:"pagination"`
}

type ListOptions struct {
	Page     int
	PageSize int
	Sort     string
	Query    string
	Filters  map[string]string
}

type Store struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type Configuration struct {
	ID       string          `json:"id"`
	Settings json.RawMessage `json:"settings"`
}

type Context struct {
	Principal     Principal      `json:"principal"`
	Stores        []Store        `json:"stores"`
	Configuration *Configuration `json:"configuration"`
}
