-- Account classification and centrally reviewed company applications.
ALTER TABLE audit.events DROP CONSTRAINT events_actor_type_check;
ALTER TABLE audit.events ADD CONSTRAINT events_actor_type_check CHECK (actor_type IN ('staff', 'participant', 'operator', 'system', 'user'));
ALTER TABLE auth.users
  ADD COLUMN account_type text NOT NULL DEFAULT 'general' CHECK (account_type IN ('general', 'business')),
  ADD COLUMN display_name text NOT NULL DEFAULT '' CHECK (length(display_name) <= 200),
  ADD COLUMN version integer NOT NULL DEFAULT 0 CHECK (version >= 0);
DROP TRIGGER users_columns ON auth.users;
CREATE TRIGGER users_columns BEFORE UPDATE ON auth.users FOR EACH ROW
  EXECUTE FUNCTION app.allow_columns('email', 'email_verified', 'status', 'account_type', 'display_name', 'version');
UPDATE auth.users u SET account_type='business'
 WHERE EXISTS (SELECT 1 FROM auth.staff_links l WHERE l.user_id=u.id AND l.revoked_at IS NULL);

CREATE TABLE app.company_profiles (
  company_id uuid PRIMARY KEY REFERENCES app.tenants(id),
  profile jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(profile)='object'),
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER company_profiles_columns BEFORE UPDATE ON app.company_profiles FOR EACH ROW
  EXECUTE FUNCTION app.allow_columns('profile', 'version', 'updated_at');
CREATE TRIGGER company_profiles_no_delete BEFORE DELETE ON app.company_profiles FOR EACH ROW EXECUTE FUNCTION app.reject_change();
CREATE TRIGGER company_profiles_no_truncate BEFORE TRUNCATE ON app.company_profiles FOR EACH STATEMENT EXECUTE FUNCTION app.reject_change();

CREATE TABLE auth.management_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES auth.users(id),
  request_key uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('business_upgrade', 'company_create', 'company_profile_update')),
  company_id uuid REFERENCES app.tenants(id),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid REFERENCES auth.users(id),
  decided_at timestamptz,
  decision_reason text NOT NULL DEFAULT '' CHECK (length(decision_reason) <= 2000),
  UNIQUE (requester_id, request_key),
  CHECK ((status='pending') = (decided_by IS NULL AND decided_at IS NULL)),
  CHECK (status='pending' OR (decided_by IS NOT NULL AND decided_at IS NOT NULL AND btrim(decision_reason)<>'')),
  CHECK (kind<>'company_profile_update' OR company_id IS NOT NULL),
  CHECK (kind<>'business_upgrade' OR company_id IS NULL)
);
CREATE UNIQUE INDEX management_requests_one_pending ON auth.management_requests
  (requester_id, kind, COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE status='pending';
CREATE INDEX management_requests_review ON auth.management_requests(status, created_at DESC);
CREATE TRIGGER management_requests_initial BEFORE INSERT ON auth.management_requests FOR EACH ROW EXECUTE FUNCTION app.require_initial_status('pending');
CREATE TRIGGER management_requests_columns BEFORE UPDATE ON auth.management_requests FOR EACH ROW
  EXECUTE FUNCTION app.allow_columns('company_id', 'status', 'decided_by', 'decided_at', 'decision_reason');
CREATE TRIGGER management_requests_decided BEFORE UPDATE ON auth.management_requests FOR EACH ROW
  WHEN (OLD.status<>'pending') EXECUTE FUNCTION app.reject_change();
CREATE TRIGGER management_requests_no_delete BEFORE DELETE ON auth.management_requests FOR EACH ROW EXECUTE FUNCTION app.reject_change();
CREATE TRIGGER management_requests_no_truncate BEFORE TRUNCATE ON auth.management_requests FOR EACH STATEMENT EXECUTE FUNCTION app.reject_change();
