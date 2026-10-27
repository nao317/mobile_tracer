package business

import (
	"bytes"
	"encoding/json"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestDraftEntryRules(t *testing.T) {
	min, max := 0.0, 100.0
	length := 3
	rules := recordRules{Fields: map[string]fieldRule{
		"count": {Type: "integer", Minimum: &min, Maximum: &max, Required: true},
		"note":  {Type: "string", MaxLength: &length, Nullable: true},
		"flag":  {Type: "boolean"}, "choice": {Type: "string", Enum: []string{"a", "b"}},
	}}
	for _, tt := range []struct {
		input string
		valid bool
	}{
		{`{}`, true}, {`{"count":0}`, true}, {`{"count":100}`, true}, {`{"note":"あいう","flag":false,"choice":"a"}`, true},
		{`{"note":null}`, true}, {`{"count":-1}`, false}, {`{"count":101}`, false}, {`{"count":1.5}`, false},
		{`{"count":"1"}`, false}, {`{"count":null}`, false}, {`{"count":1e1000}`, false},
		{`{"count":1.0}`, false}, {`{"count":1e1}`, false}, {`{"count":1.0000000000000000001}`, false},
		{`{"note":"あいうえ"}`, false}, {`{"flag":1}`, false}, {`{"choice":"c"}`, false},
		{`{"unknown":1}`, false}, {`{"count":{}}`, false},
	} {
		t.Run(tt.input, func(t *testing.T) {
			var entries map[string]json.RawMessage
			if err := json.Unmarshal([]byte(tt.input), &entries); err != nil {
				t.Fatal(err)
			}
			err := validateEntries(entries, rules)
			if (err == nil) != tt.valid {
				t.Fatalf("valid=%t err=%v", tt.valid, err)
			}
		})
	}
}

func TestOptionalPatch(t *testing.T) {
	var omitted, null, value VehiclePatch
	for raw, dst := range map[string]*VehiclePatch{`{}`: &omitted, `{"model_name":null}`: &null, `{"model_name":"車両"}`: &value} {
		if err := json.Unmarshal([]byte(raw), dst); err != nil {
			t.Fatal(err)
		}
	}
	if omitted.ModelName.Set || !null.ModelName.Set || null.ModelName.Value != nil || !value.ModelName.Set || *value.ModelName.Value != "車両" {
		t.Fatal("PATCH presence distinction lost")
	}
}

func TestErrorsDoNotExposeDatabaseDetails(t *testing.T) {
	for _, err := range []error{errors.New("postgres://secret"), &pgconn.PgError{Code: "23505", Message: "secret"}, &pgconn.PgError{Code: "P0001", Message: "secret"}} {
		b, _ := json.Marshal(PublicError(err))
		if bytes.Contains(b, []byte("secret")) {
			t.Fatal("database details leaked")
		}
		if json.Valid(b) == false {
			t.Fatal("invalid public error")
		}
		var output map[string]any
		_ = json.Unmarshal(b, &output)
		if output["message"] == "secret" {
			t.Fatal("database error leaked")
		}
	}
}
