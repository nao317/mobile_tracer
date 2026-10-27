package server

import (
	"net/url"
	"testing"
)

func TestParseBusinessList(t *testing.T) {
	for _, tt := range []struct {
		kind, query string
		valid       bool
	}{
		{"vehicles", "", true}, {"vehicles", "page=2&page_size=100&sort=-model_name&q=car", true},
		{"cases", "status=cancelled&case_type=rental&stage=intake", true},
		{"versions", "status=submitted&sort=-version_no", true},
		{"vehicles", "page=-1", false}, {"vehicles", "page_size=0", false}, {"vehicles", "page_size=101", false},
		{"vehicles", "page=1&page=2", false}, {"vehicles", "sort=--created_at", false}, {"vehicles", "sort=id", false},
		{"records", "q=anything", false}, {"versions", "status=in_progress", false}, {"cases", "tenant_id=fake", false},
		{"cases", "store_id=invalid", false}, {"vehicles", "q=", false},
	} {
		t.Run(tt.kind+"/"+tt.query, func(t *testing.T) {
			q, err := url.ParseQuery(tt.query)
			if err != nil {
				t.Fatal(err)
			}
			o, err := parseList(q, tt.kind)
			if (err == nil) != tt.valid {
				t.Fatalf("options=%+v error=%v", o, err)
			}
			if err == nil && (o.Page < 1 || o.PageSize < 1 || o.PageSize > 100) {
				t.Fatalf("unsafe pagination: %+v", o)
			}
		})
	}
}
