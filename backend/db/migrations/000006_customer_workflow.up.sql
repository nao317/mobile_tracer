-- Images are stored transactionally in PostgreSQL, included in DB backups.
CREATE TABLE app.workflow_media (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, case_id uuid NOT NULL,
 record_version_id uuid NOT NULL, request_key uuid NOT NULL, position text NOT NULL CHECK(length(position) BETWEEN 1 AND 100),
 mime_type text NOT NULL CHECK(mime_type IN ('image/jpeg','image/png','image/webp')),
 bytes bytea NOT NULL CHECK(octet_length(bytes) BETWEEN 1 AND 10485760), sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),
 actor_id uuid NOT NULL REFERENCES auth.users(id), device_captured_at timestamptz,
 latitude numeric(9,6), longitude numeric(9,6), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,request_key), UNIQUE(record_version_id,position),
 FOREIGN KEY(tenant_id,case_id,record_version_id) REFERENCES app.record_versions(tenant_id,case_id,id),
 CHECK((latitude IS NULL)=(longitude IS NULL)), CHECK(latitude BETWEEN -90 AND 90), CHECK(longitude BETWEEN -180 AND 180)
);
CREATE TRIGGER workflow_media_draft BEFORE INSERT OR UPDATE OR DELETE ON app.workflow_media FOR EACH ROW EXECUTE FUNCTION app.guard_version_child();
CREATE TRIGGER workflow_media_fixed BEFORE UPDATE OR DELETE ON app.workflow_media FOR EACH ROW EXECUTE FUNCTION app.reject_change();
CREATE TABLE app.workflow_presentations (
 version_id uuid PRIMARY KEY REFERENCES app.record_versions(id),
 content bytea NOT NULL, content_hash text NOT NULL CHECK(content_hash ~ '^[0-9a-f]{64}$'),
 actor_id uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER workflow_presentations_fixed BEFORE UPDATE OR DELETE ON app.workflow_presentations FOR EACH ROW EXECUTE FUNCTION app.reject_change();
CREATE TABLE app.workflow_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), version_id uuid NOT NULL REFERENCES app.workflow_presentations(version_id),
 user_id uuid NOT NULL REFERENCES auth.users(id), qualification text NOT NULL CHECK(qualification IN ('owner','renter','purchaser','repair_requester','approver')),
 kind text NOT NULL CHECK(kind IN ('view','receipt','state_agreement','work_authorization')),
 statement text NOT NULL CHECK(length(statement) BETWEEN 1 AND 4000), deadline timestamptz NOT NULL,
 UNIQUE(version_id,user_id,kind)
);
CREATE TRIGGER workflow_requests_fixed BEFORE UPDATE OR DELETE ON app.workflow_requests FOR EACH ROW EXECUTE FUNCTION app.reject_change();
CREATE TABLE app.workflow_responses (
 request_id uuid PRIMARY KEY REFERENCES app.workflow_requests(id), actor_id uuid NOT NULL REFERENCES auth.users(id),
 decision text NOT NULL CHECK(decision IN ('approved','rejected','held')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER workflow_responses_fixed BEFORE UPDATE OR DELETE ON app.workflow_responses FOR EACH ROW EXECUTE FUNCTION app.reject_change();
CREATE TABLE app.workflow_anchors (
 version_id uuid PRIMARY KEY REFERENCES app.workflow_presentations(version_id),
 manifest bytea NOT NULL, manifest_hash text NOT NULL CHECK(manifest_hash ~ '^[0-9a-f]{64}$'),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sending','unknown','registered','failed')),
 raw_tx text, txid text, attempts integer NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now(),
 registered_at timestamptz, CHECK((raw_tx IS NULL)=(txid IS NULL))
);
CREATE FUNCTION app.guard_workflow_anchor() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION '登録履歴は削除できません'; END IF;
 IF TG_OP='UPDATE' AND (OLD.manifest<>NEW.manifest OR OLD.manifest_hash<>NEW.manifest_hash OR OLD.version_id<>NEW.version_id OR (OLD.raw_tx IS NOT NULL AND (OLD.raw_tx IS DISTINCT FROM NEW.raw_tx OR OLD.txid IS DISTINCT FROM NEW.txid)) OR OLD.status='registered') THEN RAISE EXCEPTION '登録内容は変更できません'; END IF;
 IF NOT EXISTS(SELECT 1 FROM app.workflow_requests WHERE version_id=NEW.version_id AND kind IN ('state_agreement','work_authorization')) OR EXISTS(SELECT 1 FROM app.workflow_requests q LEFT JOIN app.workflow_responses r ON r.request_id=q.id WHERE q.version_id=NEW.version_id AND (r.decision IS DISTINCT FROM 'approved' OR r.actor_id IS DISTINCT FROM q.user_id OR r.created_at>q.deadline)) THEN RAISE EXCEPTION '顧客承認が揃っていません'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER workflow_anchor_guard BEFORE INSERT OR UPDATE OR DELETE ON app.workflow_anchors FOR EACH ROW EXECUTE FUNCTION app.guard_workflow_anchor();
CREATE TABLE app.workflow_ownerships (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, case_id uuid NOT NULL,
 vehicle_id uuid NOT NULL, user_id uuid NOT NULL REFERENCES auth.users(id), actor_id uuid NOT NULL REFERENCES auth.users(id),
 effective_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,case_id) REFERENCES app.cases(tenant_id,id),
 FOREIGN KEY(tenant_id,vehicle_id) REFERENCES app.vehicles(tenant_id,id)
);
CREATE TRIGGER workflow_ownerships_fixed BEFORE UPDATE OR DELETE ON app.workflow_ownerships FOR EACH ROW EXECUTE FUNCTION app.reject_change();
-- Shared history is an explicit, immutable redacted copy. It does not grant
-- permission to the original case, media, identities or other record versions.
CREATE TABLE app.workflow_shares (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), version_id uuid NOT NULL REFERENCES app.workflow_presentations(version_id),
 sender_id uuid NOT NULL REFERENCES auth.users(id), recipient_id uuid NOT NULL REFERENCES auth.users(id),
 content bytea NOT NULL, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 accepted_at timestamptz, revoked_at timestamptz, CHECK(sender_id<>recipient_id)
);
CREATE TRIGGER workflow_shares_columns BEFORE UPDATE ON app.workflow_shares FOR EACH ROW EXECUTE FUNCTION app.allow_columns('accepted_at','revoked_at');
CREATE TRIGGER workflow_shares_no_delete BEFORE DELETE ON app.workflow_shares FOR EACH ROW EXECUTE FUNCTION app.reject_change();
CREATE UNIQUE INDEX workflow_ownership_event_unique ON app.workflow_ownerships(tenant_id,vehicle_id,user_id,effective_at);
