package authn

import (
	"encoding/json"
	"io"
	"mime"
	"net/http"

	"github.com/nao317/mobile_tracer/backend/internal/business"
)

func decodeJSON(r *http.Request, dest any) error {
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "application/json" {
		return business.Invalid("body", "JSON形式で送信してください。")
	}
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if err := d.Decode(dest); err != nil {
		return business.Invalid("body", "JSONを確認してください。")
	}
	if d.Decode(new(any)) != io.EOF {
		return business.Invalid("body", "JSONを一つだけ指定してください。")
	}
	return nil
}
