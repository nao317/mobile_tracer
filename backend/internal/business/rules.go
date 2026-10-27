package business

import (
	"bytes"
	"encoding/json"
	"math"
	"slices"
	"strings"
	"unicode/utf8"
)

func (p Principal) admin() bool {
	for _, r := range p.Roles {
		if r.Role == "tenant_admin" {
			return true
		}
	}
	return false
}

func (p Principal) globalRead() bool {
	if p.admin() {
		return true
	}
	for _, r := range p.Roles {
		if r.Role == "auditor" && r.StoreID == nil {
			return true
		}
	}
	return false
}

func (p Principal) allowedStore(storeID string, write, manager bool) bool {
	for _, r := range p.Roles {
		if write && r.Role == "auditor" {
			continue
		}
		if manager && r.Role != "tenant_admin" && r.Role != "store_manager" {
			continue
		}
		if r.StoreID == nil || strings.EqualFold(*r.StoreID, storeID) {
			return true
		}
	}
	return false
}

func (p Principal) canWrite(c caseRow) bool {
	if p.allowedStore(c.StoreID, true, true) {
		return true
	}
	return p.allowedStore(c.StoreID, true, false) && (c.CreatedBy == p.StaffID || c.AssigneeID != nil && *c.AssigneeID == p.StaffID)
}

// Settings version 1 is the minimum configuration contract for these CRUD APIs.
// Required fields are intentionally checked on submission, not while saving drafts.
type settings struct {
	SchemaVersion int                      `json:"schema_version"`
	Businesses    map[string]businessRules `json:"businesses"`
}

type businessRules struct {
	Stages      []string               `json:"stages"`
	Transitions map[string][]string    `json:"transitions"`
	RecordKinds map[string]recordRules `json:"record_kinds"`
}

type recordRules struct {
	Fields map[string]fieldRule `json:"fields"`
}
type fieldRule struct {
	Type      string   `json:"type"`
	Required  bool     `json:"required"`
	Nullable  bool     `json:"nullable"`
	Minimum   *float64 `json:"minimum"`
	Maximum   *float64 `json:"maximum"`
	MaxLength *int     `json:"max_length"`
	Enum      []string `json:"enum"`
}

func parseRules(raw []byte, caseType string) (businessRules, error) {
	bad := Conflict("構成版の項目・業務段階の定義を確認してください。")
	var s settings
	if json.Unmarshal(raw, &s) != nil || s.SchemaVersion != 1 {
		return businessRules{}, bad
	}
	b, ok := s.Businesses[caseType]
	if !ok || len(b.Stages) == 0 || len(b.RecordKinds) == 0 {
		return businessRules{}, bad
	}
	seen := map[string]bool{}
	for _, stage := range b.Stages {
		if checkText("stage", stage, 100) != nil || seen[stage] {
			return businessRules{}, bad
		}
		seen[stage] = true
	}
	for from, targets := range b.Transitions {
		if !seen[from] {
			return businessRules{}, bad
		}
		for _, to := range targets {
			if !seen[to] {
				return businessRules{}, bad
			}
		}
	}
	for name, record := range b.RecordKinds {
		if checkText("record_kind", name, 100) != nil || record.Fields == nil {
			return businessRules{}, bad
		}
		for key, f := range record.Fields {
			if checkText("item_key", key, 100) != nil || strings.Contains(key, ".") {
				return businessRules{}, bad
			}
			if !slices.Contains([]string{"string", "number", "integer", "boolean"}, f.Type) {
				return businessRules{}, bad
			}
			if f.Minimum != nil && f.Maximum != nil && *f.Minimum > *f.Maximum {
				return businessRules{}, bad
			}
			if f.MaxLength != nil && *f.MaxLength < 0 {
				return businessRules{}, bad
			}
			if (f.Minimum != nil || f.Maximum != nil) && f.Type != "number" && f.Type != "integer" {
				return businessRules{}, bad
			}
			if (f.MaxLength != nil || len(f.Enum) > 0) && f.Type != "string" {
				return businessRules{}, bad
			}
		}
	}
	return b, nil
}

func validateEntries(entries map[string]json.RawMessage, rules recordRules) error {
	if len(entries) > 100 {
		return Invalid("entries", "項目数は100件以内にしてください。")
	}
	for key, raw := range entries {
		f, ok := rules.Fields[key]
		if !ok {
			return Invalid("entries."+key, "構成版にない項目です。")
		}
		var v any
		decoder := json.NewDecoder(bytes.NewReader(raw))
		decoder.UseNumber()
		if decoder.Decode(&v) != nil {
			return Invalid("entries."+key, "JSONの値を指定してください。")
		}
		valid := true
		switch value := v.(type) {
		case nil:
			valid = f.Nullable
		case string:
			valid = f.Type == "string" && (f.MaxLength == nil || utf8.RuneCountInString(value) <= *f.MaxLength) &&
				(len(f.Enum) == 0 || slices.Contains(f.Enum, value))
		case bool:
			valid = f.Type == "boolean"
		case json.Number:
			n, err := value.Float64()
			valid = err == nil && !math.IsInf(n, 0) && (f.Type == "number" || f.Type == "integer" && math.Trunc(n) == n) &&
				(f.Minimum == nil || n >= *f.Minimum) && (f.Maximum == nil || n <= *f.Maximum)
			if f.Type == "integer" {
				_, err := value.Int64()
				valid = valid && err == nil && math.Abs(n) <= 9007199254740991
			}
		default:
			valid = false
		}
		if !valid {
			return Invalid("entries."+key, "構成版の型・値の制約に合う値を指定してください。")
		}
	}
	return nil
}
