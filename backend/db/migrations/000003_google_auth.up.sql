-- Google の本人識別、担当者への明示的な紐付け、アプリ用セッション。
-- 認証の期限はログインの有効期限であり、業務記録の保存期限ではない。
CREATE SCHEMA auth;

CREATE TABLE auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issuer text NOT NULL CHECK (issuer = 'https://accounts.google.com'),
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 255),
  email text NOT NULL DEFAULT '',
  email_verified boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (issuer, subject)
);
CREATE TRIGGER users_columns BEFORE UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION app.allow_columns('email', 'email_verified', 'status');

CREATE TABLE auth.staff_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  tenant_id uuid NOT NULL,
  staff_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  FOREIGN KEY (tenant_id, staff_id) REFERENCES app.staff_members(tenant_id, id)
);
CREATE UNIQUE INDEX staff_links_active ON auth.staff_links(user_id, staff_id) WHERE revoked_at IS NULL;
CREATE TRIGGER staff_links_columns BEFORE UPDATE ON auth.staff_links
  FOR EACH ROW EXECUTE FUNCTION app.allow_columns('revoked_at');
CREATE TRIGGER staff_links_revoked BEFORE UPDATE ON auth.staff_links
  FOR EACH ROW WHEN (OLD.revoked_at IS NOT NULL) EXECUTE FUNCTION app.reject_change();

CREATE TABLE auth.oauth_flows (
  state_hash text PRIMARY KEY CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  browser_hash text NOT NULL CHECK (browser_hash ~ '^[0-9a-f]{64}$'),
  nonce_hash text NOT NULL CHECK (nonce_hash ~ '^[0-9a-f]{64}$'),
  verifier text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  CHECK (created_at < expires_at)
);
CREATE TRIGGER oauth_flows_columns BEFORE UPDATE ON auth.oauth_flows
  FOR EACH ROW EXECUTE FUNCTION app.allow_columns('used_at');
CREATE TRIGGER oauth_flows_used BEFORE UPDATE ON auth.oauth_flows
  FOR EACH ROW WHEN (OLD.used_at IS NOT NULL) EXECUTE FUNCTION app.reject_change();

CREATE TABLE auth.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  selected_staff_id uuid REFERENCES app.staff_members(id),
  csrf_hash text NOT NULL CHECK (csrf_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (created_at < expires_at)
);
CREATE INDEX sessions_user ON auth.sessions(user_id);
CREATE TRIGGER sessions_columns BEFORE UPDATE ON auth.sessions
  FOR EACH ROW EXECUTE FUNCTION app.allow_columns('selected_staff_id', 'revoked_at');
CREATE TRIGGER sessions_revoked BEFORE UPDATE ON auth.sessions
  FOR EACH ROW WHEN (OLD.revoked_at IS NOT NULL) EXECUTE FUNCTION app.reject_change();

CREATE TABLE auth.refresh_tokens (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  session_id uuid NOT NULL REFERENCES auth.sessions(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  CHECK (created_at < expires_at)
);
CREATE INDEX refresh_tokens_session ON auth.refresh_tokens(session_id);
CREATE TRIGGER refresh_tokens_columns BEFORE UPDATE ON auth.refresh_tokens
  FOR EACH ROW EXECUTE FUNCTION app.allow_columns('used_at');
CREATE TRIGGER refresh_tokens_used BEFORE UPDATE ON auth.refresh_tokens
  FOR EACH ROW WHEN (OLD.used_at IS NOT NULL) EXECUTE FUNCTION app.reject_change();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['users', 'staff_links', 'oauth_flows', 'sessions', 'refresh_tokens'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON auth.%I FOR EACH ROW EXECUTE FUNCTION app.reject_change()', t || '_no_delete', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON auth.%I FOR EACH STATEMENT EXECUTE FUNCTION app.reject_change()', t || '_no_truncate', t);
  END LOOP;
END $$;
