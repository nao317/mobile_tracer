package business

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5/pgconn"
	"gorm.io/gorm"
)

type Error struct {
	Status  int                 `json:"-"`
	Code    string              `json:"code"`
	Message string              `json:"message"`
	Fields  map[string][]string `json:"fields"`
}

func (e *Error) Error() string   { return e.Code }
func (e *Error) StatusCode() int { return e.Status }

func problem(status int, code, message string) *Error {
	return &Error{Status: status, Code: code, Message: message, Fields: map[string][]string{}}
}

func Invalid(field, message string) *Error {
	e := problem(400, "validation_error", "入力内容を確認してください。")
	e.Fields[field] = []string{message}
	return e
}

func Unauthorized() *Error { return problem(401, "unauthorized", "認証が必要です。") }
func Forbidden() *Error {
	return problem(403, "forbidden", "この操作を行う権限がありません。")
}
func NotFound() *Error               { return problem(404, "not_found", "対象が見つかりません。") }
func Conflict(message string) *Error { return problem(409, "conflict", message) }

// PublicError never exposes database messages, SQL or connection information.
func PublicError(err error) *Error {
	var apiErr *Error
	if errors.As(err, &apiErr) {
		return apiErr
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return NotFound()
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return problem(503, "timeout", "処理が時間内に完了しませんでした。結果を確認してください。")
	}
	var pg *pgconn.PgError
	if errors.As(err, &pg) {
		switch pg.Code {
		case "23505", "40001", "40P01":
			return Conflict("データが競合しています。最新の内容を確認してください。")
		case "23503", "23514", "23502", "22P02":
			return Invalid("body", "入力値または参照先が不正です。")
		case "P0001":
			return Conflict("現在の状態では変更できません。")
		}
	}
	return problem(500, "internal_error", "処理に失敗しました。")
}

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

func ValidID(value string) bool { return uuidPattern.MatchString(value) }

func checkID(field, value string) error {
	if !ValidID(value) {
		return Invalid(field, "UUIDを指定してください。")
	}
	return nil
}

func checkText(field, value string, max int) error {
	if strings.TrimSpace(value) == "" || utf8.RuneCountInString(value) > max {
		return Invalid(field, "空白以外の文字を上限文字数以内で入力してください。")
	}
	return nil
}
