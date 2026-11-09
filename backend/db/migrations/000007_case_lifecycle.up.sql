-- A case row is a proposal until the named customer approves the latest terms.
ALTER TABLE app.cases DROP CONSTRAINT cases_status_check;
ALTER TABLE app.cases ADD CONSTRAINT cases_status_check CHECK(status IN ('awaiting_customer','in_progress','completed','cancelled'));
ALTER TABLE app.cases ALTER COLUMN status SET DEFAULT 'awaiting_customer';
DROP TRIGGER cases_closed ON app.cases;
CREATE TRIGGER cases_closed BEFORE UPDATE ON app.cases FOR EACH ROW WHEN(OLD.status IN ('completed','cancelled')) EXECUTE FUNCTION app.reject_change();
-- Existing open cases must also obtain a named customer's acceptance.
UPDATE app.cases SET status='awaiting_customer' WHERE status='in_progress';
CREATE TABLE app.case_start_requests(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), case_id uuid NOT NULL REFERENCES app.cases(id), version_no integer NOT NULL CHECK(version_no>0),
 customer_id uuid NOT NULL REFERENCES auth.users(id), actor_id uuid NOT NULL REFERENCES auth.users(id),
 terms bytea NOT NULL, terms_hash text NOT NULL CHECK(terms_hash ~ '^[0-9a-f]{64}$'), deadline timestamptz NOT NULL,
 request_key uuid NOT NULL UNIQUE,created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(case_id,version_no)
);
CREATE TABLE app.case_start_responses(
 request_id uuid PRIMARY KEY REFERENCES app.case_start_requests(id), actor_id uuid NOT NULL REFERENCES auth.users(id),
 decision text NOT NULL CHECK(decision IN ('approved','rejected','held')),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER case_start_requests_fixed BEFORE UPDATE OR DELETE ON app.case_start_requests FOR EACH ROW EXECUTE FUNCTION app.reject_change();
CREATE TRIGGER case_start_responses_fixed BEFORE UPDATE OR DELETE ON app.case_start_responses FOR EACH ROW EXECUTE FUNCTION app.reject_change();
CREATE TABLE app.case_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),case_id uuid NOT NULL REFERENCES app.cases(id),actor_id uuid NOT NULL REFERENCES auth.users(id),
 origin text NOT NULL CHECK(origin IN ('business','customer')),kind text NOT NULL CHECK(kind IN ('work','progress_report','incident','request')),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 200),description text NOT NULL CHECK(length(description) BETWEEN 1 AND 8000),
 amount_minor bigint CHECK(amount_minor>=0),target_stage text, deadline timestamptz NOT NULL,
 supersedes_id uuid REFERENCES app.case_events(id),parent_event_id uuid REFERENCES app.case_events(id),request_key uuid NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(case_id,id),
 CHECK((origin='business' AND kind IN ('work','progress_report')) OR(origin='customer' AND kind IN ('incident','request'))),
 CHECK(kind='work' OR (amount_minor IS NULL AND target_stage IS NULL))
);
CREATE TABLE app.case_event_actions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id uuid NOT NULL REFERENCES app.case_events(id),actor_id uuid NOT NULL REFERENCES auth.users(id),
 action text NOT NULL CHECK(action IN ('approved','rejected','held','returned','executed','reported','completed')),
 detail text NOT NULL DEFAULT '' CHECK(length(detail)<=8000),request_key uuid NOT NULL UNIQUE,created_at timestamptz NOT NULL DEFAULT now(),
 sequence integer NOT NULL CHECK(sequence>0),UNIQUE(event_id,sequence)
);
CREATE TRIGGER case_events_fixed BEFORE UPDATE OR DELETE ON app.case_events FOR EACH ROW EXECUTE FUNCTION app.reject_change();
CREATE TRIGGER case_event_actions_fixed BEFORE UPDATE OR DELETE ON app.case_event_actions FOR EACH ROW EXECUTE FUNCTION app.reject_change();
CREATE TABLE app.case_stage_executions(
 event_id uuid PRIMARY KEY REFERENCES app.case_events(id),case_id uuid NOT NULL REFERENCES app.cases(id),from_stage text NOT NULL,to_stage text NOT NULL,
 transaction_id bigint NOT NULL DEFAULT txid_current(),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER case_stage_executions_fixed BEFORE UPDATE OR DELETE ON app.case_stage_executions FOR EACH ROW EXECUTE FUNCTION app.reject_change();
CREATE FUNCTION app.guard_case_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status='awaiting_customer' AND NEW.status='in_progress' AND NOT EXISTS(
  SELECT 1 FROM app.case_start_requests q JOIN app.case_start_responses r ON r.request_id=q.id AND r.actor_id=q.customer_id AND r.decision='approved' AND r.created_at<=q.deadline
  WHERE q.case_id=OLD.id AND q.version_no=(SELECT max(version_no) FROM app.case_start_requests WHERE case_id=OLD.id)
 ) THEN RAISE EXCEPTION '顧客の案件開始承認が必要です'; END IF;
 IF OLD.status='awaiting_customer' AND NEW.stage<>OLD.stage THEN RAISE EXCEPTION '案件開始承認前は進行できません';END IF;
 IF NEW.stage<>OLD.stage AND EXISTS(SELECT 1 FROM app.case_start_requests WHERE case_id=OLD.id) AND NOT EXISTS(
 SELECT 1 FROM app.case_stage_executions x JOIN app.case_events e ON e.id=x.event_id
 WHERE x.case_id=OLD.id AND x.from_stage=OLD.stage AND x.to_stage=NEW.stage AND x.transaction_id=txid_current()
 AND EXISTS(SELECT 1 FROM app.case_event_actions a WHERE a.event_id=e.id AND a.action='approved')
 AND EXISTS(SELECT 1 FROM app.case_event_actions a WHERE a.event_id=e.id AND a.action='executed')
 ) THEN RAISE EXCEPTION '承認済み作業の実行を通じて段階を変更してください';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER cases_lifecycle_guard BEFORE UPDATE ON app.cases FOR EACH ROW EXECUTE FUNCTION app.guard_case_lifecycle();
-- One outbox for record versions, case acceptance and event agreement/completion.
CREATE TABLE integrity.api_registrations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),subject_type text NOT NULL CHECK(subject_type IN ('record','case_start','event_approval','event_completion')),
 subject_id uuid NOT NULL,manifest bytea NOT NULL,manifest_hash text NOT NULL CHECK(manifest_hash ~ '^[0-9a-f]{64}$'),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','submitting','unconfirmed','confirmed','unknown','failed')),
 timestamp_id bigint,txid text,attempts integer NOT NULL DEFAULT 0,provider_scope text,provider_result jsonb,updated_at timestamptz NOT NULL DEFAULT now(),confirmed_at timestamptz,
 UNIQUE(subject_type,subject_id),CHECK((timestamp_id IS NULL)=(txid IS NULL)),CHECK(txid IS NULL OR txid ~ '^[0-9a-f]{64}$')
);
CREATE FUNCTION integrity.guard_api_registration() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION '登録履歴は削除できません';END IF;
 IF OLD.manifest IS DISTINCT FROM NEW.manifest OR OLD.manifest_hash IS DISTINCT FROM NEW.manifest_hash OR OLD.subject_id IS DISTINCT FROM NEW.subject_id OR OLD.subject_type IS DISTINCT FROM NEW.subject_type OR(OLD.timestamp_id IS NOT NULL AND(OLD.timestamp_id IS DISTINCT FROM NEW.timestamp_id OR OLD.txid IS DISTINCT FROM NEW.txid)) OR(OLD.provider_scope IS NOT NULL AND OLD.provider_scope IS DISTINCT FROM NEW.provider_scope) OR OLD.status='confirmed' THEN RAISE EXCEPTION '登録対象は変更できません';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER api_registration_guard BEFORE UPDATE OR DELETE ON integrity.api_registrations FOR EACH ROW EXECUTE FUNCTION integrity.guard_api_registration();
CREATE INDEX api_registration_pending ON integrity.api_registrations(updated_at) WHERE status<>'confirmed';
-- Resume only unsent records through the API; already signed Core transactions
-- keep their original provider and are never silently re-registered.
INSERT INTO integrity.api_registrations(subject_type,subject_id,manifest,manifest_hash)
 SELECT 'record',version_id,manifest,manifest_hash FROM app.workflow_anchors WHERE raw_tx IS NULL AND status<>'registered';
