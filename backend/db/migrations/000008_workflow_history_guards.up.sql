-- Row-level guards do not run for TRUNCATE. Protect the workflow tables added
-- after the initial migration without changing already-applied migrations.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'workflow_media', 'workflow_presentations', 'workflow_requests',
    'workflow_responses', 'workflow_anchors', 'workflow_ownerships', 'workflow_shares',
    'case_start_requests', 'case_start_responses', 'case_events',
    'case_event_actions', 'case_stage_executions'
  ] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON app.%I FOR EACH STATEMENT EXECUTE FUNCTION app.reject_change()',
                   t || '_no_truncate', t);
  END LOOP;
END $$;
CREATE TRIGGER api_registrations_no_truncate BEFORE TRUNCATE ON integrity.api_registrations
  FOR EACH STATEMENT EXECUTE FUNCTION app.reject_change();

-- Older requests were created with their immutable presentation. For existing
-- registrations only updated_at is available; preserve it as the backfill.
ALTER TABLE app.workflow_requests ADD COLUMN created_at timestamptz;
ALTER TABLE app.workflow_requests DISABLE TRIGGER workflow_requests_fixed;
UPDATE app.workflow_requests q SET created_at = p.created_at
  FROM app.workflow_presentations p WHERE p.version_id = q.version_id;
ALTER TABLE app.workflow_requests ENABLE TRIGGER workflow_requests_fixed;
ALTER TABLE app.workflow_requests ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE app.workflow_requests ALTER COLUMN created_at SET NOT NULL;

ALTER TABLE integrity.api_registrations ADD COLUMN created_at timestamptz;
ALTER TABLE integrity.api_registrations DISABLE TRIGGER api_registration_guard;
UPDATE integrity.api_registrations SET created_at = updated_at;
ALTER TABLE integrity.api_registrations ENABLE TRIGGER api_registration_guard;
ALTER TABLE integrity.api_registrations ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE integrity.api_registrations ALTER COLUMN created_at SET NOT NULL;
CREATE TRIGGER api_registrations_columns BEFORE UPDATE ON integrity.api_registrations
  FOR EACH ROW EXECUTE FUNCTION app.allow_columns(
    'status', 'timestamp_id', 'txid', 'attempts', 'provider_scope',
    'provider_result', 'updated_at', 'confirmed_at');
