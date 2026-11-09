package authn

import (
	"time"

	"github.com/labstack/echo/v5"
)

type historyItem struct {
	TargetType     string    `json:"target_type"`
	TargetID       string    `json:"target_id"`
	Action         string    `json:"action"`
	Decision       string    `json:"decision"`
	At             time.Time `json:"at"`
	Count          int64     `json:"count"`
	OwnApplication bool      `json:"own_application"`
}

// Return business actions grouped by their transaction, never page visits.
// A user sees their own actions and decisions on their own applications.
// Details, other actors' identities and unrelated tenants are not returned.
func (s *Service) listTransactionHistory(c *echo.Context) error {
	userID := managementActor(c).User.ID
	db := s.db.WithContext(c.Request().Context())
	grouped := db.Raw(`
 WITH scoped AS (
 SELECT CASE WHEN target_type='record' THEN 'record_version' ELSE target_type END AS target_type,
 CASE WHEN target_type='record' THEN details->>'version_id' ELSE target_id::text END AS target_id,
 action,details,created_at,id,
 EXISTS(SELECT 1 FROM auth.management_requests r WHERE r.id=e.target_id AND r.requester_id=?) AS own_application
 FROM audit.events e
 WHERE target_id IS NOT NULL AND result='succeeded'
 AND target_type IN ('record','record_version','case','management_request')
 AND (action LIKE 'transaction.%' OR action LIKE 'case.%' OR action LIKE 'record.%' OR action LIKE 'draft.%' OR action LIKE 'management.request_%')
 AND ((actor_type='user' AND actor_id=?) OR
 (actor_type='staff' AND EXISTS(SELECT 1 FROM auth.staff_links l WHERE l.staff_id=e.actor_id AND l.tenant_id=e.tenant_id AND l.user_id=? AND l.revoked_at IS NULL)) OR
 (target_type='management_request' AND EXISTS(SELECT 1 FROM auth.management_requests r WHERE r.id=e.target_id AND r.requester_id=?)))
 )
 SELECT target_type,target_id,action,COALESCE(details->>'decision','') AS decision,created_at AS at,own_application,
 count(*) OVER (PARTITION BY target_type,target_id) AS count,
 row_number() OVER (PARTITION BY target_type,target_id ORDER BY created_at DESC,id DESC) AS position
 FROM scoped WHERE target_id IS NOT NULL`, userID, userID, userID, userID)
	result, err := listPage[historyItem](c, db.Table("(?) AS history", grouped).Where("position=1"), "at DESC,target_type,target_id")
	if err != nil {
		return err
	}
	return c.JSON(200, result)
}
