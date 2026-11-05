-- Firebase Authenticationへ移行する。業務記録と既存の認証履歴は保持する。
ALTER TABLE auth.users DROP CONSTRAINT users_issuer_check;
ALTER TABLE auth.users ADD CONSTRAINT users_issuer_check CHECK (
  issuer = 'https://accounts.google.com' OR
  issuer ~ '^https://securetoken[.]google[.]com/[a-z][a-z0-9-]{4,62}$'
);
ALTER TABLE auth.users ADD CONSTRAINT users_firebase_uid_check CHECK (
  issuer = 'https://accounts.google.com' OR length(subject) BETWEEN 1 AND 128
);
-- 旧JWTは受け付けない。旧担当者との紐付けはUIDを確認して明示的に登録し直す。
UPDATE auth.sessions SET revoked_at=now() WHERE revoked_at IS NULL;
ALTER TABLE auth.sessions ADD COLUMN token_hash text CHECK (token_hash ~ '^[0-9a-f]{64}$');
CREATE INDEX sessions_token_hash ON auth.sessions(token_hash) WHERE token_hash IS NOT NULL;
COMMENT ON COLUMN auth.sessions.token_hash IS 'Firebase session cookieのSHA-256。旧セッションはNULLのまま保持する。';
COMMENT ON TABLE auth.oauth_flows IS '旧Google直接OAuthの履歴。Firebase移行後は新規利用しない。';
COMMENT ON TABLE auth.refresh_tokens IS '旧アプリJWTの更新履歴。Firebase移行後は新規利用しない。';
CREATE TABLE auth.login_challenges (
  challenge_hash text PRIMARY KEY CHECK (challenge_hash ~ '^[0-9a-f]{64}$'),
  browser_hash text NOT NULL CHECK (browser_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  CHECK (created_at < expires_at)
);
CREATE TRIGGER login_challenges_columns BEFORE UPDATE ON auth.login_challenges
  FOR EACH ROW EXECUTE FUNCTION app.allow_columns('used_at');
CREATE TRIGGER login_challenges_used BEFORE UPDATE ON auth.login_challenges
  FOR EACH ROW WHEN (OLD.used_at IS NOT NULL) EXECUTE FUNCTION app.reject_change();
CREATE TRIGGER login_challenges_no_delete BEFORE DELETE ON auth.login_challenges
  FOR EACH ROW EXECUTE FUNCTION app.reject_change();
CREATE TRIGGER login_challenges_no_truncate BEFORE TRUNCATE ON auth.login_challenges
  FOR EACH STATEMENT EXECUTE FUNCTION app.reject_change();
