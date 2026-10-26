-- MobilTracer の最初のスキーマ
-- 要件定義書 v0.2.0 をもとにした案。共有の DB に流すまでは、このファイルを直接直してよい。
-- 説明と書き方の決まりは docs/schema/tables.md、ER 図は docs/schema/er.md を参照。
-- PostgreSQL 14 以上を想定（gen_random_uuid を使う）。
-- ファイル全体を一度に実行すると、PostgreSQL は一つのトランザクションとして扱う。途中で失敗しても何も残らない。

CREATE SCHEMA app;        -- 業務データ
CREATE SCHEMA integrity;  -- 検証基準と照合結果。業務データと権限を分ける（NFR-03）
CREATE SCHEMA audit;      -- 監査履歴。追記のみ（FR-C16）

-- ---------------------------------------------------------------
-- 共通のトリガー関数
-- ---------------------------------------------------------------

-- 変更・削除を認めない行に付ける。表の TRUNCATE を止めるのにも使う
CREATE FUNCTION app.reject_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION '%.% は TRUNCATE できません', TG_TABLE_SCHEMA, TG_TABLE_NAME;
  END IF;
  RAISE EXCEPTION '%.% のこの行は変更・削除できません', TG_TABLE_SCHEMA, TG_TABLE_NAME;
END $$;

-- 引数に書いた列だけ更新を認める。ほかの列が変わったら止める
CREATE FUNCTION app.allow_columns() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  changed text;
BEGIN
  SELECT string_agg(n.key, ', ') INTO changed
    FROM jsonb_each(to_jsonb(NEW)) n
    JOIN jsonb_each(to_jsonb(OLD)) o USING (key)
   WHERE n.value IS DISTINCT FROM o.value
     AND n.key <> ALL (TG_ARGV);
  IF changed IS NOT NULL THEN
    RAISE EXCEPTION '%.% の % は変更できません', TG_TABLE_SCHEMA, TG_TABLE_NAME, changed;
  END IF;
  RETURN NEW;
END $$;

-- 引数の列が指す記録版が提出済みかを確かめる。提出済みの版は下書きに戻らないので、ロックは要らない
CREATE FUNCTION app.require_submitted() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  col text;
  vid uuid;
BEGIN
  FOREACH col IN ARRAY TG_ARGV LOOP
    vid := (to_jsonb(NEW) ->> col)::uuid;
    IF vid IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM app.record_versions WHERE id = vid AND status = 'submitted'
    ) THEN
      RAISE EXCEPTION '%.% には提出済みの記録版だけを指定できます', TG_TABLE_NAME, col;
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------
-- 組織と権限（FR-C01、FR-T06）
-- ---------------------------------------------------------------

CREATE TABLE app.tenants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  -- 環境を作り終えて顧客が確認するまでは provisioning のまま（FR-T01）
  status      text NOT NULL DEFAULT 'provisioning'
              CHECK (status IN ('provisioning', 'active', 'suspended', 'closed')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.stores (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants (id),
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

-- 退職した人も行は消さない。過去の記録の作成者・提出者として指されているため
CREATE TABLE app.staff_members (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES app.tenants (id),
  display_name  text NOT NULL,
  email         text NOT NULL,
  status        text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'suspended')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, email)
);

-- 提供側（運営）の担当者。顧客のデータには support_grants で許可された範囲だけ入れる
CREATE TABLE app.provider_operators (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name  text NOT NULL,
  email         text NOT NULL UNIQUE,
  role          text NOT NULL CHECK (role IN ('admin', 'onboarding', 'support')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  disabled_by   uuid REFERENCES app.provider_operators (id),
  disabled_at   timestamptz,
  CHECK ((disabled_by IS NULL) = (disabled_at IS NULL))
);

-- 基本の表も、変えてよい列を決めておく。id、所属の顧客、作成日時は変えない
CREATE TRIGGER tenants_columns
  BEFORE UPDATE ON app.tenants
  FOR EACH ROW EXECUTE FUNCTION app.allow_columns('name', 'status');
CREATE TRIGGER stores_columns
  BEFORE UPDATE ON app.stores
  FOR EACH ROW EXECUTE FUNCTION app.allow_columns('name');
CREATE TRIGGER staff_members_columns
  BEFORE UPDATE ON app.staff_members
  FOR EACH ROW EXECUTE FUNCTION app.allow_columns('display_name', 'email', 'status');
CREATE TRIGGER provider_operators_columns
  BEFORE UPDATE ON app.provider_operators
  FOR EACH ROW EXECUTE FUNCTION app.allow_columns('display_name', 'email', 'role', 'disabled_by', 'disabled_at');

-- 役割の付与。一人に複数の役割を付けられる。最初の管理者だけは提供側が付ける
CREATE TABLE app.staff_role_assignments (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,
  staff_id             uuid NOT NULL,
  role                 text NOT NULL CHECK (role IN ('tenant_admin', 'store_manager', 'staff', 'auditor')),
  store_id             uuid,  -- NULL なら全店舗
  created_by_staff     uuid,
  created_by_operator  uuid REFERENCES app.provider_operators (id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  revoked_by           uuid,
  revoked_at           timestamptz,
  FOREIGN KEY (tenant_id, staff_id) REFERENCES app.staff_members (tenant_id, id),
  FOREIGN KEY (tenant_id, store_id) REFERENCES app.stores (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by_staff) REFERENCES app.staff_members (tenant_id, id),
  FOREIGN KEY (tenant_id, revoked_by) REFERENCES app.staff_members (tenant_id, id),
  CHECK (num_nonnulls(created_by_staff, created_by_operator) = 1),
  CHECK (role <> 'tenant_admin' OR store_id IS NULL),
  CHECK (role <> 'store_manager' OR store_id IS NOT NULL),
  CHECK ((revoked_by IS NULL) = (revoked_at IS NULL))
);

-- 有効な付与は、同じ人・役割・店舗で1つまで（store_id の NULL も同じ値として比べる）
CREATE UNIQUE INDEX staff_role_assignments_active
  ON app.staff_role_assignments (staff_id, role, coalesce(store_id, '00000000-0000-0000-0000-000000000000'))
  WHERE revoked_at IS NULL;

CREATE TRIGGER staff_role_assignments_columns
  BEFORE UPDATE ON app.staff_role_assignments
  FOR EACH ROW EXECUTE FUNCTION app.allow_columns('revoked_by', 'revoked_at');
CREATE TRIGGER staff_role_assignments_revoked
  BEFORE UPDATE ON app.staff_role_assignments
  FOR EACH ROW WHEN (OLD.revoked_at IS NOT NULL) EXECUTE FUNCTION app.reject_change();
CREATE TRIGGER staff_role_assignments_no_delete
  BEFORE DELETE ON app.staff_role_assignments
  FOR EACH ROW EXECUTE FUNCTION app.reject_change();

-- 顧客が提供側のサポート担当に出す閲覧の許可。MVP は閲覧だけなので操作の範囲は持たない
-- 期間（valid_to）は変えられないので、延ばすときは新しく許可を出す
CREATE TABLE app.support_grants (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES app.tenants (id),
  operator_id  uuid NOT NULL REFERENCES app.provider_operators (id),
  purpose      text NOT NULL,
  valid_from   timestamptz NOT NULL,
  valid_to     timestamptz NOT NULL,
  created_by   uuid NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  revoked_by   uuid,
  revoked_at   timestamptz,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.staff_members (tenant_id, id),
  FOREIGN KEY (tenant_id, revoked_by) REFERENCES app.staff_members (tenant_id, id),
  CHECK (valid_from < valid_to),
  CHECK ((revoked_by IS NULL) = (revoked_at IS NULL))
);

CREATE TRIGGER support_grants_columns
  BEFORE UPDATE ON app.support_grants
  FOR EACH ROW EXECUTE FUNCTION app.allow_columns('revoked_by', 'revoked_at');
CREATE TRIGGER support_grants_revoked
  BEFORE UPDATE ON app.support_grants
  FOR EACH ROW WHEN (OLD.revoked_at IS NOT NULL) EXECUTE FUNCTION app.reject_change();
CREATE TRIGGER support_grants_no_delete
  BEFORE DELETE ON app.support_grants
  FOR EACH ROW EXECUTE FUNCTION app.reject_change();

-- ---------------------------------------------------------------
-- テンプレートと構成版（FR-T01〜T03）
-- ---------------------------------------------------------------

-- 業態ごとの初期設定。提供側が版を増やしていき、作った版は変えない
CREATE TABLE app.business_templates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_type  text NOT NULL CHECK (business_type IN ('rental', 'dealer', 'repair')),
  version_no     integer NOT NULL,
  definition     jsonb NOT NULL,  -- 撮影箇所、点検項目、段階などの初期値
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_type, version_no),
  UNIQUE (id, business_type)
);

CREATE TRIGGER business_templates_fixed
  BEFORE UPDATE OR DELETE ON app.business_templates
  FOR EACH ROW EXECUTE FUNCTION app.reject_change();

-- 顧客ごとの設定の版。下書き→試行→本番反映と進み、反映した版は中身を変えない
CREATE TABLE app.configuration_versions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES app.tenants (id),
  version_no           integer NOT NULL,
  status               text NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft', 'trial', 'published', 'superseded')),
  based_on_id          uuid,
  -- 項目、撮影箇所、段階と移行条件、期限、用語など。顧客ごとに形が変わるので jsonb にする
  settings             jsonb NOT NULL,
  created_by_staff     uuid,
  created_by_operator  uuid REFERENCES app.provider_operators (id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  published_by         uuid,
  published_at         timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, version_no),
  FOREIGN KEY (tenant_id, based_on_id) REFERENCES app.configuration_versions (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by_staff) REFERENCES app.staff_members (tenant_id, id),
  FOREIGN KEY (tenant_id, published_by) REFERENCES app.staff_members (tenant_id, id),
  CHECK (num_nonnulls(created_by_staff, created_by_operator) = 1),
  CHECK ((published_by IS NULL) = (published_at IS NULL)),
  CHECK ((status IN ('published', 'superseded')) = (published_at IS NOT NULL))
);

-- 本番の版はテナントに1つ。同時に反映しようとした片方はここで止まる
CREATE UNIQUE INDEX configuration_versions_one_published
  ON app.configuration_versions (tenant_id) WHERE status = 'published';

CREATE FUNCTION app.guard_configuration_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status NOT IN ('published', 'superseded') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  -- 反映後に認めるのは published から superseded への切り替えだけ
  IF TG_OP = 'UPDATE'
     AND to_jsonb(NEW) - 'status' = to_jsonb(OLD) - 'status'
     AND (NEW.status = OLD.status OR NEW.status = 'superseded') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '反映済みの構成版は変更・削除できません';
END $$;

CREATE TRIGGER configuration_versions_columns
  BEFORE UPDATE ON app.configuration_versions
  FOR EACH ROW EXECUTE FUNCTION app.allow_columns('status', 'settings', 'published_by', 'published_at');
CREATE TRIGGER configuration_versions_guard
  BEFORE UPDATE OR DELETE ON app.configuration_versions
  FOR EACH ROW EXECUTE FUNCTION app.guard_configuration_version();

-- 構成版で使う業態と、元にしたテンプレート。複数の業態を併用できる（FR-T01）
CREATE TABLE app.configuration_modules (
  tenant_id                 uuid NOT NULL,
  configuration_version_id  uuid NOT NULL,
  business_type             text NOT NULL,
  template_id               uuid NOT NULL,
  PRIMARY KEY (configuration_version_id, business_type),
  UNIQUE (tenant_id, configuration_version_id, business_type),
  FOREIGN KEY (tenant_id, configuration_version_id) REFERENCES app.configuration_versions (tenant_id, id),
  -- テンプレートの業態と食い違わないよう、業態ごと参照する
  FOREIGN KEY (template_id, business_type) REFERENCES app.business_templates (id, business_type)
);

-- 業態の組み合わせを変えられるのは、構成版が下書きか試行のあいだだけ
CREATE FUNCTION app.guard_configuration_module() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  st text;
BEGIN
  FOR st IN
    SELECT status FROM app.configuration_versions
     WHERE id IN (OLD.configuration_version_id, NEW.configuration_version_id)
     FOR SHARE
  LOOP
    IF st IN ('published', 'superseded') THEN
      RAISE EXCEPTION '反映済みの構成版の業態は変更できません';
    END IF;
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE TRIGGER configuration_modules_guard
  BEFORE INSERT OR UPDATE OR DELETE ON app.configuration_modules
  FOR EACH ROW EXECUTE FUNCTION app.guard_configuration_module();
CREATE TRIGGER configuration_modules_columns
  BEFORE UPDATE ON app.configuration_modules
  FOR EACH ROW EXECUTE FUNCTION app.allow_columns('template_id');

-- 少量の CSV 取り込み（FR-T04）。提供側が試行し、顧客の管理者が結果を確かめてから本取込する
CREATE TABLE app.import_jobs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES app.tenants (id),
  file_name       text NOT NULL,
  file_sha256     text NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  status          text NOT NULL DEFAULT 'trial'
                  CHECK (status IN ('trial', 'confirmed', 'committed', 'failed')),
  -- 件数は import_job_rows から数えるので持たない
  created_by      uuid NOT NULL REFERENCES app.provider_operators (id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  confirmed_by    uuid,
  confirmed_at    timestamptz,
  committed_at    timestamptz,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, confirmed_by) REFERENCES app.staff_members (tenant_id, id),
  CHECK ((confirmed_by IS NULL) = (confirmed_at IS NULL)),
  CHECK (status NOT IN ('confirmed', 'committed') OR confirmed_at IS NOT NULL),
  CHECK ((status = 'committed') = (committed_at IS NOT NULL))
);

-- 同じファイルを二度本取込しない
CREATE UNIQUE INDEX import_jobs_committed_file
  ON app.import_jobs (tenant_id, file_sha256) WHERE status = 'committed';

CREATE TRIGGER import_jobs_columns
  BEFORE UPDATE ON app.import_jobs
  FOR EACH ROW EXECUTE FUNCTION app.allow_columns('status', 'confirmed_by', 'confirmed_at', 'committed_at');
CREATE TRIGGER import_jobs_finished
  BEFORE UPDATE ON app.import_jobs
  FOR EACH ROW WHEN (OLD.status IN ('committed', 'failed')) EXECUTE FUNCTION app.reject_change();
CREATE TRIGGER import_jobs_no_delete
  BEFORE DELETE ON app.import_jobs
  FOR EACH ROW EXECUTE FUNCTION app.reject_change();

-- 取込の行ごとの結果。正常・重複・不正の件数はここから数える
CREATE TABLE app.import_job_rows (
  tenant_id      uuid NOT NULL,
  import_job_id  uuid NOT NULL,
  row_no         integer NOT NULL CHECK (row_no > 0),
  result         text NOT NULL CHECK (result IN ('ok', 'duplicate', 'error')),
  message        text,
  PRIMARY KEY (import_job_id, row_no),
  FOREIGN KEY (tenant_id, import_job_id) REFERENCES app.import_jobs (tenant_id, id),
  CHECK ((result = 'ok') = (message IS NULL))
);

CREATE TRIGGER import_job_rows_fixed
  BEFORE UPDATE OR DELETE ON app.import_job_rows
  FOR EACH ROW EXECUTE FUNCTION app.reject_change();

-- ---------------------------------------------------------------
-- 関係者と車両（FR-C02、FR-C18）
-- ---------------------------------------------------------------

-- 顧客、依頼者、購入者など社外の人・会社。個人情報はこの表にまとめる
CREATE TABLE app.parties (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES app.tenants (id),
  kind            text NOT NULL CHECK (kind IN ('person', 'organization')),
  display_name    text,
  phone           text,
  email           text,
  postal_address  text,
  -- 削除の手続きで個人情報を消した日時。ほかの表から指されているので行は残す
  erased_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (erased_at IS NOT NULL OR display_name IS NOT NULL),
  CHECK (erased_at IS NULL OR num_nonnulls(display_name, phone, email, postal_address) = 0)
);

CREATE TRIGGER parties_columns
  BEFORE UPDATE ON app.parties
  FOR EACH ROW EXECUTE FUNCTION app.allow_columns(
    'display_name', 'phone', 'email', 'postal_address', 'erased_at');
CREATE TRIGGER parties_erased
  BEFORE UPDATE ON app.parties
  FOR EACH ROW WHEN (OLD.erased_at IS NOT NULL) EXECUTE FUNCTION app.reject_change();

-- 車両。ナンバーや所有者が変わっても id は変えない
-- 仮登録かどうかは、確認済みの車台番号・VIN があるかで分かるので列にしない
CREATE TABLE app.vehicles (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES app.tenants (id),
  model_name     text,
  -- CSV から取り込んだ車両は、取込と取込元の識別子を持つ。NULL なら現場で登録した車両
  import_job_id  uuid,
  source_key     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, source_key),
  FOREIGN KEY (tenant_id, import_job_id) REFERENCES app.import_jobs (tenant_id, id),
  CHECK ((import_job_id IS NULL) = (source_key IS NULL))
);

CREATE TRIGGER vehicles_columns
  BEFORE UPDATE ON app.vehicles
  FOR EACH ROW EXECUTE FUNCTION app.allow_columns('model_name');

-- 車台番号、VIN、ナンバー。ナンバーは付け替えがあるので有効期間を持つ
CREATE TABLE app.vehicle_identifiers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  vehicle_id   uuid NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('chassis_number', 'vin', 'plate_number')),
  value        text NOT NULL,
  valid_from   date,
  valid_to     date,
  created_at   timestamptz NOT NULL DEFAULT now(),
  verified_by  uuid,
  verified_at  timestamptz,
  FOREIGN KEY (tenant_id, vehicle_id) REFERENCES app.vehicles (tenant_id, id),
  FOREIGN KEY (tenant_id, verified_by) REFERENCES app.staff_members (tenant_id, id),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_from <= valid_to),
  CHECK ((verified_by IS NULL) = (verified_at IS NULL))
);

-- 確認済みで今も有効な識別子は、テナントの中で重ならない。未確認のものは重複を許す
CREATE UNIQUE INDEX vehicle_identifiers_verified
  ON app.vehicle_identifiers (tenant_id, kind, value)
  WHERE verified_at IS NOT NULL AND valid_to IS NULL;
-- 今のナンバーは1台に1つ
CREATE UNIQUE INDEX vehicle_identifiers_current_plate
  ON app.vehicle_identifiers (vehicle_id)
  WHERE kind = 'plate_number' AND valid_to IS NULL;

CREATE TRIGGER vehicle_identifiers_columns
  BEFORE UPDATE ON app.vehicle_identifiers
  FOR EACH ROW EXECUTE FUNCTION app.allow_columns('valid_to', 'verified_by', 'verified_at');

-- 所有者の有効期間。案件の関係者（case_participants）とは別に、車両の側で持つ（FR-C18）
CREATE TABLE app.vehicle_ownerships (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  vehicle_id      uuid NOT NULL,
  owner_party_id  uuid NOT NULL,
  valid_from      date NOT NULL,
  valid_to        date,
  created_at      timestamptz NOT NULL DEFAULT now(),
  verified_by     uuid,
  verified_at     timestamptz,
  FOREIGN KEY (tenant_id, vehicle_id) REFERENCES app.vehicles (tenant_id, id),
  FOREIGN KEY (tenant_id, owner_party_id) REFERENCES app.parties (tenant_id, id),
  FOREIGN KEY (tenant_id, verified_by) REFERENCES app.staff_members (tenant_id, id),
  CHECK (valid_to IS NULL OR valid_from <= valid_to),
  CHECK ((verified_by IS NULL) = (verified_at IS NULL))
);

CREATE UNIQUE INDEX vehicle_ownerships_current
  ON app.vehicle_ownerships (vehicle_id) WHERE valid_to IS NULL;

CREATE TRIGGER vehicle_ownerships_columns
  BEFORE UPDATE ON app.vehicle_ownerships
  FOR EACH ROW EXECUTE FUNCTION app.allow_columns('valid_to', 'verified_by', 'verified_at');

-- 重複して登録した車両の統合。統合済みかどうかはこの表だけで判断する
-- 統合元の車両と案件はそのまま残し、提出版の車両表示も変えない
CREATE TABLE app.vehicle_merges (
  source_vehicle_id  uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL,
  target_vehicle_id  uuid NOT NULL,
  reason             text NOT NULL,
  created_by         uuid NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, source_vehicle_id) REFERENCES app.vehicles (tenant_id, id),
  FOREIGN KEY (tenant_id, target_vehicle_id) REFERENCES app.vehicles (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.staff_members (tenant_id, id),
  CHECK (source_vehicle_id <> target_vehicle_id)
);

-- 統合先がすでにどこかへ統合されていたら止める。これで統合が輪にならない
CREATE FUNCTION app.guard_vehicle_merge() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM app.vehicles
   WHERE id IN (NEW.source_vehicle_id, NEW.target_vehicle_id)
   ORDER BY id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM app.vehicle_merges WHERE source_vehicle_id = NEW.target_vehicle_id) THEN
    RAISE EXCEPTION '統合先の車両はすでに別の車両へ統合されています';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER vehicle_merges_guard
  BEFORE INSERT ON app.vehicle_merges
  FOR EACH ROW EXECUTE FUNCTION app.guard_vehicle_merge();
CREATE TRIGGER vehicle_merges_fixed
  BEFORE UPDATE OR DELETE ON app.vehicle_merges
  FOR EACH ROW EXECUTE FUNCTION app.reject_change();

-- ---------------------------------------------------------------
-- 案件と関係者（FR-C03）
-- ---------------------------------------------------------------

CREATE TABLE app.cases (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL,
  store_id                  uuid NOT NULL,
  vehicle_id                uuid NOT NULL,
  case_type                 text NOT NULL,
  -- 案件がいま使っている構成版。明示して移行したときだけ変わる（FR-T03）
  configuration_version_id  uuid NOT NULL,
  assignee_id               uuid,
  stage                     text NOT NULL,  -- 業務段階。段階の一覧は構成版で決める
  status                    text NOT NULL DEFAULT 'in_progress'
                            CHECK (status IN ('in_progress', 'completed', 'cancelled')),
  completed_by              uuid,
  completed_at              timestamptz,
  cancelled_by              uuid,
  cancelled_at              timestamptz,
  cancel_reason             text,
  created_by                uuid NOT NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, store_id) REFERENCES app.stores (tenant_id, id),
  FOREIGN KEY (tenant_id, vehicle_id) REFERENCES app.vehicles (tenant_id, id),
  -- 案件の種類は、その構成版で使うと決めた業態に限る
  FOREIGN KEY (tenant_id, configuration_version_id, case_type)
    REFERENCES app.configuration_modules (tenant_id, configuration_version_id, business_type),
  FOREIGN KEY (tenant_id, assignee_id) REFERENCES app.staff_members (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.staff_members (tenant_id, id),
  FOREIGN KEY (tenant_id, completed_by) REFERENCES app.staff_members (tenant_id, id),
  FOREIGN KEY (tenant_id, cancelled_by) REFERENCES app.staff_members (tenant_id, id),
  CHECK (num_nonnulls(completed_by, completed_at) = CASE status WHEN 'completed' THEN 2 ELSE 0 END),
  CHECK (num_nonnulls(cancelled_by, cancelled_at, cancel_reason) = CASE status WHEN 'cancelled' THEN 3 ELSE 0 END)
);

CREATE INDEX cases_vehicle ON app.cases (tenant_id, vehicle_id);

-- 案件が使えるのは本番反映した構成版だけ。試行は試行環境で行う（FR-T01、FR-T03）
-- 反映済みの版は published のまま中身が変わらないので、FOR SHARE で反映の切り替えと順番をそろえる
CREATE FUNCTION app.require_published_configuration() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM app.configuration_versions
     WHERE id = NEW.configuration_version_id AND status = 'published'
     FOR SHARE
  ) THEN
    RAISE EXCEPTION '案件には本番反映した構成版だけを指定できます';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER cases_configuration
  BEFORE INSERT OR UPDATE OF configuration_version_id ON app.cases
  FOR EACH ROW EXECUTE FUNCTION app.require_published_configuration();
CREATE TRIGGER cases_columns
  BEFORE UPDATE ON app.cases
  FOR EACH ROW EXECUTE FUNCTION app.allow_columns(
    'store_id', 'configuration_version_id', 'assignee_id', 'stage', 'status',
    'completed_by', 'completed_at', 'cancelled_by', 'cancelled_at', 'cancel_reason');
-- 完了・中止した案件は動かさない。訂正は記録の新しい版で行う
CREATE TRIGGER cases_closed
  BEFORE UPDATE ON app.cases
  FOR EACH ROW WHEN (OLD.status <> 'in_progress') EXECUTE FUNCTION app.reject_change();

-- 案件の関係者。同じ人でも案件ごとに資格と関わる期間を持つ
-- 関わる期間より前の記録は、関係者になっただけでは見せない
CREATE TABLE app.case_participants (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  case_id        uuid NOT NULL,
  party_id       uuid NOT NULL,
  qualification  text NOT NULL CHECK (qualification IN (
                   'owner', 'renter', 'purchaser', 'repair_requester',
                   'approver', 'insurer', 'other_business', 'other')),
  valid_from     timestamptz NOT NULL DEFAULT now(),
  valid_to       timestamptz,
  created_by     uuid NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, case_id, id),
  FOREIGN KEY (tenant_id, case_id) REFERENCES app.cases (tenant_id, id),
  FOREIGN KEY (tenant_id, party_id) REFERENCES app.parties (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.staff_members (tenant_id, id),
  CHECK (valid_to IS NULL OR valid_from < valid_to)
);

-- 同じ人を同じ資格で二重に登録しない
CREATE UNIQUE INDEX case_participants_active
  ON app.case_participants (case_id, party_id, qualification) WHERE valid_to IS NULL;

CREATE TRIGGER case_participants_columns
  BEFORE UPDATE ON app.case_participants
  FOR EACH ROW EXECUTE FUNCTION app.allow_columns('valid_to');

-- サポートの許可で見てよい案件
CREATE TABLE app.support_grant_cases (
  tenant_id         uuid NOT NULL,
  support_grant_id  uuid NOT NULL,
  case_id           uuid NOT NULL,
  PRIMARY KEY (support_grant_id, case_id),
  FOREIGN KEY (tenant_id, support_grant_id) REFERENCES app.support_grants (tenant_id, id),
  FOREIGN KEY (tenant_id, case_id) REFERENCES app.cases (tenant_id, id)
);

CREATE TRIGGER support_grant_cases_fixed
  BEFORE UPDATE OR DELETE ON app.support_grant_cases
  FOR EACH ROW EXECUTE FUNCTION app.reject_change();

-- ---------------------------------------------------------------
-- 記録と記録版（FR-C04〜C07、FR-C11）
-- ---------------------------------------------------------------

-- 案件の中の記録（貸出前点検、見積など）。中身は record_versions に版で持つ
CREATE TABLE app.records (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  case_id      uuid NOT NULL,
  record_kind  text NOT NULL,  -- 記録の種類。一覧は構成版で決める
  created_by   uuid NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, case_id, id),
  FOREIGN KEY (tenant_id, case_id) REFERENCES app.cases (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.staff_members (tenant_id, id)
);

CREATE TRIGGER records_fixed
  BEFORE UPDATE ON app.records
  FOR EACH ROW EXECUTE FUNCTION app.reject_change();

-- 記録の版。下書きで作って提出し、提出した版は二度と変えない
-- 訂正・補足は元の版を based_on_version_id で指す新しい版にする
CREATE TABLE app.record_versions (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL,
  case_id                   uuid NOT NULL,
  record_id                 uuid NOT NULL,
  version_no                integer NOT NULL CHECK (version_no > 0),
  status                    text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted')),
  based_on_version_id       uuid,
  change_kind               text CHECK (change_kind IN ('correction', 'supplement')),
  change_reason             text,
  -- 入力に使った構成版。案件の構成版は後で移行することがあるので、版ごとに持つ
  configuration_version_id  uuid NOT NULL,
  lock_version              integer NOT NULL DEFAULT 0,  -- 同時編集の検出用
  -- ここから下は提出のときに入れる
  vehicle_snapshot          jsonb,  -- 提出時点の車両表示（ナンバーなど）。統合しても変えない
  hash_algorithm            text,
  content_hash              text,
  submit_idempotency_key    uuid,   -- 提出の再送で同じ結果を返すためのキー
  submitted_by              uuid,
  submitted_at              timestamptz,
  created_by                uuid NOT NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, case_id, id),
  UNIQUE (record_id, id),
  UNIQUE (record_id, version_no),
  UNIQUE (tenant_id, submit_idempotency_key),
  FOREIGN KEY (tenant_id, case_id, record_id) REFERENCES app.records (tenant_id, case_id, id),
  -- 元の版は同じ記録の版に限る
  FOREIGN KEY (record_id, based_on_version_id) REFERENCES app.record_versions (record_id, id),
  FOREIGN KEY (tenant_id, configuration_version_id) REFERENCES app.configuration_versions (tenant_id, id),
  FOREIGN KEY (tenant_id, submitted_by) REFERENCES app.staff_members (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.staff_members (tenant_id, id),
  -- 1版目だけが元の版を持たない。2版目からは区分と理由が要る
  CHECK ((version_no = 1) = (based_on_version_id IS NULL)),
  CHECK (num_nonnulls(based_on_version_id, change_kind, change_reason) IN (0, 3)),
  CHECK (num_nonnulls(vehicle_snapshot, hash_algorithm, content_hash,
                      submit_idempotency_key, submitted_by, submitted_at)
         = CASE status WHEN 'submitted' THEN 6 ELSE 0 END)
);

-- 下書きは1つの記録に1つまで
CREATE UNIQUE INDEX record_versions_one_draft
  ON app.record_versions (record_id) WHERE status = 'draft';

CREATE FUNCTION app.guard_record_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'submitted' THEN
      RAISE EXCEPTION '記録版は下書きで作ってから提出してください';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'submitted' THEN
    RAISE EXCEPTION '提出済みの記録版は変更・削除できません';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE TRIGGER record_versions_guard
  BEFORE INSERT OR UPDATE OR DELETE ON app.record_versions
  FOR EACH ROW EXECUTE FUNCTION app.guard_record_version();
CREATE TRIGGER record_versions_columns
  BEFORE UPDATE ON app.record_versions
  FOR EACH ROW EXECUTE FUNCTION app.allow_columns(
    'status', 'change_reason', 'configuration_version_id', 'lock_version',
    'vehicle_snapshot', 'hash_algorithm', 'content_hash',
    'submit_idempotency_key', 'submitted_by', 'submitted_at');
CREATE TRIGGER record_versions_based_on
  BEFORE INSERT ON app.record_versions
  FOR EACH ROW EXECUTE FUNCTION app.require_submitted('based_on_version_id');

-- 記録版の構成版は、作るとき、移すとき、提出するときに案件のいまの構成版と同じか確かめる
-- 案件を移した後に残った下書きは、新しい構成版へ移してからでないと提出できない
-- 提出した版は案件が後で移行しても元の構成版のまま残る
CREATE FUNCTION app.require_case_configuration() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM app.cases
     WHERE id = NEW.case_id AND configuration_version_id = NEW.configuration_version_id
     FOR SHARE
  ) THEN
    RAISE EXCEPTION '記録版の構成版は案件の構成版と同じにしてください';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER record_versions_configuration
  BEFORE INSERT OR UPDATE OF configuration_version_id, status ON app.record_versions
  FOR EACH ROW EXECUTE FUNCTION app.require_case_configuration();

-- 記録版にぶら下がる行（項目の値、写真、傷、撮影できなかった箇所）は、親が下書きのあいだだけ変えられる
-- 親を FOR SHARE で読むので、提出の処理と同時に書き込まれることはない
CREATE FUNCTION app.guard_version_child() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  st text;
BEGIN
  FOR st IN
    SELECT status FROM app.record_versions
     WHERE id IN (OLD.record_version_id, NEW.record_version_id)
     FOR SHARE
  LOOP
    IF st = 'submitted' THEN
      RAISE EXCEPTION '提出済みの記録版の % は変更できません', TG_TABLE_NAME;
    END IF;
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END $$;

-- 点検結果などの入力値。項目は顧客ごとの構成版で決まるので、列ではなく1項目1行で持つ
-- 値の型も構成版の項目定義で決まる
CREATE TABLE app.record_entries (
  tenant_id          uuid NOT NULL,
  case_id            uuid NOT NULL,
  record_version_id  uuid NOT NULL,
  item_key           text NOT NULL,
  value              jsonb NOT NULL,
  PRIMARY KEY (record_version_id, item_key),
  UNIQUE (tenant_id, case_id, record_version_id, item_key),
  FOREIGN KEY (tenant_id, case_id, record_version_id) REFERENCES app.record_versions (tenant_id, case_id, id)
);

CREATE TRIGGER record_entries_guard
  BEFORE INSERT OR UPDATE OR DELETE ON app.record_entries
  FOR EACH ROW EXECUTE FUNCTION app.guard_version_child();
CREATE TRIGGER record_entries_columns
  BEFORE UPDATE ON app.record_entries
  FOR EACH ROW EXECUTE FUNCTION app.allow_columns('value');

-- 原本の写真。ファイルはストレージに置き、ここにはハッシュと受け取りの情報を持つ
-- 撮ったのは担当者か案件の関係者のどちらか。動画は P1 なので今は画像だけ
CREATE TABLE app.media_originals (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL,
  case_id                 uuid NOT NULL,
  mime_type               text NOT NULL CHECK (mime_type LIKE 'image/%'),
  byte_size               bigint NOT NULL CHECK (byte_size > 0),
  sha256                  text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  storage_key             text NOT NULL UNIQUE,
  created_by_staff        uuid,
  created_by_participant  uuid,
  -- 端末が申告した撮影日時。サーバーが受け取った日時は created_at
  device_captured_at      timestamptz,
  latitude                numeric(9, 6),  -- 位置は任意
  longitude               numeric(9, 6),
  idempotency_key         uuid NOT NULL,  -- 再送で二重に登録しないためのキー。端末が作る
  created_at              timestamptz NOT NULL DEFAULT now(),
  -- 削除の手続きでファイルを消した日時。ハッシュと経緯を残すため行は消さない
  deleted_at              timestamptz,
  UNIQUE (tenant_id, case_id, id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, case_id) REFERENCES app.cases (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by_staff) REFERENCES app.staff_members (tenant_id, id),
  FOREIGN KEY (tenant_id, case_id, created_by_participant)
    REFERENCES app.case_participants (tenant_id, case_id, id),
  CHECK (num_nonnulls(created_by_staff, created_by_participant) = 1),
  CHECK ((latitude IS NULL) = (longitude IS NULL))
);

CREATE TRIGGER media_originals_columns
  BEFORE UPDATE ON app.media_originals
  FOR EACH ROW EXECUTE FUNCTION app.allow_columns('deleted_at');
CREATE TRIGGER media_originals_deleted
  BEFORE UPDATE ON app.media_originals
  FOR EACH ROW WHEN (OLD.deleted_at IS NOT NULL) EXECUTE FUNCTION app.reject_change();
CREATE TRIGGER media_originals_no_delete
  BEFORE DELETE ON app.media_originals
  FOR EACH ROW EXECUTE FUNCTION app.reject_change();

-- 原本に付けた注釈やマスク。原本は書き換えず、加工した画像は別のファイルにする
-- 共有のときにマスクを足せるよう、記録版ではなく原本にぶら下げる
CREATE TABLE app.media_annotations (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,
  case_id              uuid NOT NULL,
  media_id             uuid NOT NULL,
  kind                 text NOT NULL CHECK (kind IN ('annotation', 'mask', 'crop', 'resize')),
  payload              jsonb NOT NULL,  -- 描いた図形、マスクの範囲、切り抜きの位置など
  derived_storage_key  text UNIQUE,
  derived_sha256       text CHECK (derived_sha256 ~ '^[0-9a-f]{64}$'),
  created_by           uuid NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  deleted_by           uuid,
  deleted_at           timestamptz,
  UNIQUE (id, media_id),
  FOREIGN KEY (tenant_id, case_id, media_id) REFERENCES app.media_originals (tenant_id, case_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.staff_members (tenant_id, id),
  FOREIGN KEY (tenant_id, deleted_by) REFERENCES app.staff_members (tenant_id, id),
  CHECK ((derived_storage_key IS NULL) = (derived_sha256 IS NULL)),
  CHECK ((deleted_by IS NULL) = (deleted_at IS NULL))
);

CREATE TRIGGER media_annotations_columns
  BEFORE UPDATE ON app.media_annotations
  FOR EACH ROW EXECUTE FUNCTION app.allow_columns('deleted_by', 'deleted_at');
CREATE TRIGGER media_annotations_deleted
  BEFORE UPDATE ON app.media_annotations
  FOR EACH ROW WHEN (OLD.deleted_at IS NOT NULL) EXECUTE FUNCTION app.reject_change();
CREATE TRIGGER media_annotations_no_delete
  BEFORE DELETE ON app.media_annotations
  FOR EACH ROW EXECUTE FUNCTION app.reject_change();

-- 記録版に含める写真。複合外部キーで、同じ案件の原本しか入れられない
CREATE TABLE app.record_version_media (
  tenant_id          uuid NOT NULL,
  case_id            uuid NOT NULL,
  record_version_id  uuid NOT NULL,
  media_id           uuid NOT NULL,
  spot_key           text,  -- 撮影箇所。NULL は箇所に当てはまらない追加の写真
  sort_order         integer NOT NULL DEFAULT 0,
  PRIMARY KEY (record_version_id, media_id),
  UNIQUE (tenant_id, case_id, record_version_id, media_id),
  FOREIGN KEY (tenant_id, case_id, record_version_id) REFERENCES app.record_versions (tenant_id, case_id, id),
  FOREIGN KEY (tenant_id, case_id, media_id) REFERENCES app.media_originals (tenant_id, case_id, id)
);

CREATE TRIGGER record_version_media_guard
  BEFORE INSERT OR UPDATE OR DELETE ON app.record_version_media
  FOR EACH ROW EXECUTE FUNCTION app.guard_version_child();
CREATE TRIGGER record_version_media_columns
  BEFORE UPDATE ON app.record_version_media
  FOR EACH ROW EXECUTE FUNCTION app.allow_columns('spot_key', 'sort_order');

-- 傷の位置と説明。写真の上の位置は左上を 0、右下を 1 とした比率で持つ
-- 写真を指すときは、その版に含めた写真に限る
CREATE TABLE app.damage_marks (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  case_id            uuid NOT NULL,
  record_version_id  uuid NOT NULL,
  media_id           uuid,
  x                  numeric(5, 4) CHECK (x BETWEEN 0 AND 1),
  y                  numeric(5, 4) CHECK (y BETWEEN 0 AND 1),
  description        text NOT NULL,
  created_by         uuid NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, case_id, record_version_id) REFERENCES app.record_versions (tenant_id, case_id, id),
  FOREIGN KEY (tenant_id, case_id, record_version_id, media_id)
    REFERENCES app.record_version_media (tenant_id, case_id, record_version_id, media_id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.staff_members (tenant_id, id),
  CHECK (num_nonnulls(media_id, x, y) IN (0, 3))
);

CREATE TRIGGER damage_marks_guard
  BEFORE INSERT OR UPDATE OR DELETE ON app.damage_marks
  FOR EACH ROW EXECUTE FUNCTION app.guard_version_child();
CREATE TRIGGER damage_marks_columns
  BEFORE UPDATE ON app.damage_marks
  FOR EACH ROW EXECUTE FUNCTION app.allow_columns('media_id', 'x', 'y', 'description');

-- 撮影できなかった箇所の理由と、不足を認めた責任者（FR-C05）
CREATE TABLE app.capture_exceptions (
  tenant_id          uuid NOT NULL,
  case_id            uuid NOT NULL,
  record_version_id  uuid NOT NULL,
  spot_key           text NOT NULL,
  reason             text NOT NULL,
  created_by         uuid NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  approved_by        uuid,
  approved_at        timestamptz,
  PRIMARY KEY (record_version_id, spot_key),
  FOREIGN KEY (tenant_id, case_id, record_version_id) REFERENCES app.record_versions (tenant_id, case_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.staff_members (tenant_id, id),
  FOREIGN KEY (tenant_id, approved_by) REFERENCES app.staff_members (tenant_id, id),
  CHECK ((approved_by IS NULL) = (approved_at IS NULL))
);

CREATE TRIGGER capture_exceptions_guard
  BEFORE INSERT OR UPDATE OR DELETE ON app.capture_exceptions
  FOR EACH ROW EXECUTE FUNCTION app.guard_version_child();
CREATE TRIGGER capture_exceptions_columns
  BEFORE UPDATE ON app.capture_exceptions
  FOR EACH ROW EXECUTE FUNCTION app.allow_columns('reason', 'approved_by', 'approved_at');

-- 二つの提出版の同じ箇所を比べた、担当者の判定（FR-C06）。MVP では同じ案件の中だけ
-- 判定を直すときも上書きせず行を足す。いまの判定は一番新しい行
CREATE TABLE app.record_comparisons (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  case_id            uuid NOT NULL,
  base_version_id    uuid NOT NULL,
  target_version_id  uuid NOT NULL,
  spot_key           text NOT NULL,
  judgement          text NOT NULL CHECK (judgement IN ('no_change', 'changed', 'not_comparable')),
  reason             text NOT NULL,  -- 判定の根拠。比べられないときはその理由
  created_by         uuid NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, case_id, base_version_id) REFERENCES app.record_versions (tenant_id, case_id, id),
  FOREIGN KEY (tenant_id, case_id, target_version_id) REFERENCES app.record_versions (tenant_id, case_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.staff_members (tenant_id, id),
  CHECK (base_version_id <> target_version_id)
);

CREATE INDEX record_comparisons_pair
  ON app.record_comparisons (base_version_id, target_version_id, spot_key, created_at);

CREATE TRIGGER record_comparisons_submitted
  BEFORE INSERT ON app.record_comparisons
  FOR EACH ROW EXECUTE FUNCTION app.require_submitted('base_version_id', 'target_version_id');
CREATE TRIGGER record_comparisons_fixed
  BEFORE UPDATE OR DELETE ON app.record_comparisons
  FOR EACH ROW EXECUTE FUNCTION app.reject_change();

-- ---------------------------------------------------------------
-- 異議と差し戻し（FR-C13）
-- ---------------------------------------------------------------

-- 関係者からの異議と、社内の差し戻しを1つの表で持つ
-- 関係者からなら created_by_participant、社内からなら created_by_staff が入る
CREATE TABLE app.objections (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL,
  case_id                 uuid NOT NULL,
  record_version_id       uuid NOT NULL,
  body                    text NOT NULL,
  created_by_staff        uuid,
  created_by_participant  uuid,
  -- 端末で送信した日時。受付期限の判定にはサーバーが受け取った created_at を使う
  device_sent_at          timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  -- 受け付けたか。期限後の申出も消さずに、受け付けるかどうかと理由を残す
  -- NULL は責任者の判断待ち
  acceptance              text CHECK (acceptance IN ('accepted', 'late_accepted', 'not_accepted')),
  acceptance_reason       text,
  assignee_id             uuid,
  status                  text NOT NULL DEFAULT 'received'
                          CHECK (status IN ('received', 'in_progress', 'resolved')),
  resolution              text,
  resolved_version_id     uuid,  -- 訂正して出し直した版（あれば）
  resolved_by             uuid,
  resolved_at             timestamptz,
  UNIQUE (tenant_id, case_id, id),
  UNIQUE (id, record_version_id),
  FOREIGN KEY (tenant_id, case_id, record_version_id) REFERENCES app.record_versions (tenant_id, case_id, id),
  FOREIGN KEY (tenant_id, case_id, resolved_version_id) REFERENCES app.record_versions (tenant_id, case_id, id),
  FOREIGN KEY (tenant_id, created_by_staff) REFERENCES app.staff_members (tenant_id, id),
  FOREIGN KEY (tenant_id, case_id, created_by_participant)
    REFERENCES app.case_participants (tenant_id, case_id, id),
  FOREIGN KEY (tenant_id, assignee_id) REFERENCES app.staff_members (tenant_id, id),
  FOREIGN KEY (tenant_id, resolved_by) REFERENCES app.staff_members (tenant_id, id),
  CHECK (num_nonnulls(created_by_staff, created_by_participant) = 1),
  -- 社内の差し戻しには受付期限がない
  CHECK (created_by_staff IS NULL OR acceptance IS NULL),
  CHECK (acceptance IS NULL OR acceptance = 'accepted' OR acceptance_reason IS NOT NULL),
  CHECK (num_nonnulls(resolution, resolved_by, resolved_at)
         = CASE status WHEN 'resolved' THEN 3 ELSE 0 END),
  CHECK (resolved_version_id IS NULL OR status = 'resolved')
);

CREATE TRIGGER objections_submitted
  BEFORE INSERT OR UPDATE ON app.objections
  FOR EACH ROW EXECUTE FUNCTION app.require_submitted('record_version_id', 'resolved_version_id');
CREATE TRIGGER objections_columns
  BEFORE UPDATE ON app.objections
  FOR EACH ROW EXECUTE FUNCTION app.allow_columns(
    'acceptance', 'acceptance_reason', 'assignee_id', 'status',
    'resolution', 'resolved_version_id', 'resolved_by', 'resolved_at');
CREATE TRIGGER objections_resolved
  BEFORE UPDATE ON app.objections
  FOR EACH ROW WHEN (OLD.status = 'resolved') EXECUTE FUNCTION app.reject_change();
CREATE TRIGGER objections_no_delete
  BEFORE DELETE ON app.objections
  FOR EACH ROW EXECUTE FUNCTION app.reject_change();

-- 異議の対象の項目。異議を出した版の項目に限る
CREATE TABLE app.objection_items (
  tenant_id          uuid NOT NULL,
  case_id            uuid NOT NULL,
  objection_id       uuid NOT NULL,
  record_version_id  uuid NOT NULL,
  item_key           text NOT NULL,
  PRIMARY KEY (objection_id, item_key),
  FOREIGN KEY (objection_id, record_version_id) REFERENCES app.objections (id, record_version_id),
  FOREIGN KEY (tenant_id, case_id, record_version_id, item_key)
    REFERENCES app.record_entries (tenant_id, case_id, record_version_id, item_key)
);

CREATE TRIGGER objection_items_fixed
  BEFORE UPDATE OR DELETE ON app.objection_items
  FOR EACH ROW EXECUTE FUNCTION app.reject_change();

-- 異議に添えた写真
CREATE TABLE app.objection_evidence (
  tenant_id     uuid NOT NULL,
  case_id       uuid NOT NULL,
  objection_id  uuid NOT NULL,
  media_id      uuid NOT NULL,
  PRIMARY KEY (objection_id, media_id),
  FOREIGN KEY (tenant_id, case_id, objection_id) REFERENCES app.objections (tenant_id, case_id, id),
  FOREIGN KEY (tenant_id, case_id, media_id) REFERENCES app.media_originals (tenant_id, case_id, id)
);

CREATE TRIGGER objection_evidence_fixed
  BEFORE UPDATE OR DELETE ON app.objection_evidence
  FOR EACH ROW EXECUTE FUNCTION app.reject_change();

-- ---------------------------------------------------------------
-- 確認の依頼と回答（FR-C08、FR-C14）
-- ---------------------------------------------------------------

-- 関係者への確認の依頼。何を確認してもらうか（種類、文面の版、対象の記録版）を固定する
-- 見積の内容と金額は対象の記録版に入っているので、ここには持たない
CREATE TABLE app.confirmation_requests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  case_id            uuid NOT NULL,
  record_version_id  uuid NOT NULL,
  participant_id     uuid NOT NULL,
  confirmation_type  text NOT NULL
                     CHECK (confirmation_type IN ('view', 'receipt', 'condition_agreement', 'work_approval')),
  statement_key      text NOT NULL,
  statement_version  integer NOT NULL,
  due_at             timestamptz,
  objection_id       uuid,  -- 異議を受けて出し直した再確認なら、その異議
  created_by         uuid NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  withdrawn_by       uuid,
  withdrawn_at       timestamptz,
  UNIQUE (tenant_id, case_id, id),
  UNIQUE (tenant_id, case_id, id, confirmation_type),
  FOREIGN KEY (tenant_id, case_id, record_version_id) REFERENCES app.record_versions (tenant_id, case_id, id),
  -- 依頼の相手は同じ案件の関係者に限る
  FOREIGN KEY (tenant_id, case_id, participant_id) REFERENCES app.case_participants (tenant_id, case_id, id),
  FOREIGN KEY (tenant_id, case_id, objection_id) REFERENCES app.objections (tenant_id, case_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.staff_members (tenant_id, id),
  FOREIGN KEY (tenant_id, withdrawn_by) REFERENCES app.staff_members (tenant_id, id),
  CHECK ((withdrawn_by IS NULL) = (withdrawn_at IS NULL))
);

CREATE TRIGGER confirmation_requests_submitted
  BEFORE INSERT ON app.confirmation_requests
  FOR EACH ROW EXECUTE FUNCTION app.require_submitted('record_version_id');
CREATE TRIGGER confirmation_requests_columns
  BEFORE UPDATE ON app.confirmation_requests
  FOR EACH ROW EXECUTE FUNCTION app.allow_columns('withdrawn_by', 'withdrawn_at');
CREATE TRIGGER confirmation_requests_withdrawn
  BEFORE UPDATE ON app.confirmation_requests
  FOR EACH ROW WHEN (OLD.withdrawn_at IS NOT NULL) EXECUTE FUNCTION app.reject_change();
CREATE TRIGGER confirmation_requests_no_delete
  BEFORE DELETE ON app.confirmation_requests
  FOR EACH ROW EXECUTE FUNCTION app.reject_change();

-- 確認への回答。答え直したときも前の行は残し、新しい行を足す
-- 回答者は依頼の相手。担当者が代わりに入力したときは proxy_by と代理の根拠を入れる
-- 無回答と期限切れは、回答の行がないことで表す
CREATE TABLE app.confirmation_responses (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL,
  case_id                uuid NOT NULL,
  request_id             uuid NOT NULL,
  -- 依頼の種類の写し。種類ごとに選べる答えを CHECK で絞るために持つ
  confirmation_type      text NOT NULL,
  answer                 text NOT NULL,
  proxy_by               uuid,
  proxy_basis            text,
  identity_method        text NOT NULL,  -- 本人確認の方式。方式は未決なので値は絞らない
  signature_storage_key  text,
  idempotency_key        uuid NOT NULL,  -- 再送で二重に回答しないためのキー
  created_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (tenant_id, case_id, request_id, id),
  FOREIGN KEY (tenant_id, case_id, request_id, confirmation_type)
    REFERENCES app.confirmation_requests (tenant_id, case_id, id, confirmation_type),
  FOREIGN KEY (tenant_id, proxy_by) REFERENCES app.staff_members (tenant_id, id),
  CHECK ((proxy_by IS NULL) = (proxy_basis IS NULL)),
  CHECK (
    (confirmation_type = 'view' AND answer = 'viewed')
    OR (confirmation_type = 'receipt' AND answer IN ('received', 'refused'))
    OR (confirmation_type = 'condition_agreement' AND answer IN ('agreed', 'disagreed', 'on_hold'))
    OR (confirmation_type = 'work_approval' AND answer IN ('approved', 'rejected', 'on_hold'))
  )
);

CREATE TRIGGER confirmation_responses_fixed
  BEFORE UPDATE OR DELETE ON app.confirmation_responses
  FOR EACH ROW EXECUTE FUNCTION app.reject_change();

-- 確認依頼の通知を送った記録。届いた・開いたことを回答としては扱わない
-- 送り直したときは行を足す
CREATE TABLE app.request_notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  case_id     uuid NOT NULL,
  request_id  uuid NOT NULL,
  channel     text NOT NULL CHECK (channel IN ('email', 'sms')),
  status      text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed')),
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz,
  FOREIGN KEY (tenant_id, case_id, request_id) REFERENCES app.confirmation_requests (tenant_id, case_id, id),
  CHECK ((status = 'sent') = (sent_at IS NOT NULL)),
  CHECK ((status = 'failed') = (error IS NOT NULL))
);

CREATE TRIGGER request_notifications_columns
  BEFORE UPDATE ON app.request_notifications
  FOR EACH ROW EXECUTE FUNCTION app.allow_columns('status', 'error', 'sent_at');
CREATE TRIGGER request_notifications_finished
  BEFORE UPDATE ON app.request_notifications
  FOR EACH ROW WHEN (OLD.status <> 'queued') EXECUTE FUNCTION app.reject_change();

-- 本人控え。依頼した版と本人の回答をまとめたファイル
-- 無回答や拒否でも提示した版は渡すので、回答（response_id）は NULL のことがある
CREATE TABLE app.personal_copies (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  case_id      uuid NOT NULL,
  request_id   uuid NOT NULL,
  response_id  uuid,
  storage_key  text NOT NULL UNIQUE,
  sha256       text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  created_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  FOREIGN KEY (tenant_id, case_id, request_id) REFERENCES app.confirmation_requests (tenant_id, case_id, id),
  -- 回答は同じ依頼への回答に限る
  FOREIGN KEY (tenant_id, case_id, request_id, response_id)
    REFERENCES app.confirmation_responses (tenant_id, case_id, request_id, id)
);

CREATE TRIGGER personal_copies_columns
  BEFORE UPDATE ON app.personal_copies
  FOR EACH ROW EXECUTE FUNCTION app.allow_columns('deleted_at');
CREATE TRIGGER personal_copies_deleted
  BEFORE UPDATE ON app.personal_copies
  FOR EACH ROW WHEN (OLD.deleted_at IS NOT NULL) EXECUTE FUNCTION app.reject_change();
CREATE TRIGGER personal_copies_no_delete
  BEFORE DELETE ON app.personal_copies
  FOR EACH ROW EXECUTE FUNCTION app.reject_change();

-- ---------------------------------------------------------------
-- 共有（FR-C12、FR-C18）
-- ---------------------------------------------------------------

-- 記録の共有。相手は社外の人（parties）か、別の事業者（tenants）のどちらか
-- 複数の案件の版をまとめて渡せるよう、案件ではなくテナントにぶら下げる
CREATE TABLE app.share_grants (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES app.tenants (id),
  recipient_party_id   uuid,
  recipient_tenant_id  uuid REFERENCES app.tenants (id),
  purpose              text NOT NULL,
  allow_download       boolean NOT NULL DEFAULT false,
  expires_at           timestamptz NOT NULL,
  access_token_hash    text UNIQUE,  -- 社外の人に送るリンクのトークン。平文は持たない
  -- 範囲（対象の版、項目、写真）を決め終えたら発行する。発行前は相手に見せない
  issued_by            uuid,
  issued_at            timestamptz,
  -- 事業者間の共有は、受け取る側の担当者が受け入れてから見られる
  accepted_by          uuid,
  accepted_at          timestamptz,
  created_by           uuid NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  revoked_by           uuid,
  revoked_at           timestamptz,
  revoke_reason        text,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, recipient_party_id) REFERENCES app.parties (tenant_id, id),
  FOREIGN KEY (tenant_id, issued_by) REFERENCES app.staff_members (tenant_id, id),
  FOREIGN KEY (recipient_tenant_id, accepted_by) REFERENCES app.staff_members (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.staff_members (tenant_id, id),
  FOREIGN KEY (tenant_id, revoked_by) REFERENCES app.staff_members (tenant_id, id),
  CHECK (num_nonnulls(recipient_party_id, recipient_tenant_id) = 1),
  CHECK (recipient_tenant_id IS DISTINCT FROM tenant_id),
  CHECK ((recipient_party_id IS NULL) = (access_token_hash IS NULL)),
  CHECK ((issued_by IS NULL) = (issued_at IS NULL)),
  CHECK (accepted_at IS NULL OR recipient_tenant_id IS NOT NULL),
  CHECK (accepted_at IS NULL OR issued_at IS NOT NULL),
  CHECK ((accepted_by IS NULL) = (accepted_at IS NULL)),
  CHECK (num_nonnulls(revoked_by, revoked_at, revoke_reason) IN (0, 3))
);

-- 発行前の状態で作り、範囲を決めてから発行する。発行と受け入れは一度だけ。
-- 共有する版が一つもないものは発行できない
CREATE FUNCTION app.guard_share_grant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.issued_at IS NOT NULL THEN
      RAISE EXCEPTION '共有は発行前の状態で作ってから発行してください';
    END IF;
    RETURN NEW;
  END IF;
  IF (OLD.issued_at IS NOT NULL
      AND (NEW.issued_by, NEW.issued_at) IS DISTINCT FROM (OLD.issued_by, OLD.issued_at))
  OR (OLD.accepted_at IS NOT NULL
      AND (NEW.accepted_by, NEW.accepted_at) IS DISTINCT FROM (OLD.accepted_by, OLD.accepted_at)) THEN
    RAISE EXCEPTION '共有の発行と受け入れはやり直せません';
  END IF;
  IF OLD.issued_at IS NULL AND NEW.issued_at IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM app.share_grant_targets WHERE share_grant_id = NEW.id
  ) THEN
    RAISE EXCEPTION '共有する記録版がない共有は発行できません';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER share_grants_columns
  BEFORE UPDATE ON app.share_grants
  FOR EACH ROW EXECUTE FUNCTION app.allow_columns(
    'issued_by', 'issued_at', 'accepted_by', 'accepted_at', 'revoked_by', 'revoked_at', 'revoke_reason');
CREATE TRIGGER share_grants_guard
  BEFORE INSERT OR UPDATE ON app.share_grants
  FOR EACH ROW EXECUTE FUNCTION app.guard_share_grant();
CREATE TRIGGER share_grants_revoked
  BEFORE UPDATE ON app.share_grants
  FOR EACH ROW WHEN (OLD.revoked_at IS NOT NULL) EXECUTE FUNCTION app.reject_change();
CREATE TRIGGER share_grants_no_delete
  BEFORE DELETE ON app.share_grants
  FOR EACH ROW EXECUTE FUNCTION app.reject_change();

-- 共有の範囲を足せるのは発行する前だけ。親を FOR SHARE で読むので、発行と同時に足されることはない
CREATE FUNCTION app.require_unissued_share() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM app.share_grants
     WHERE id = NEW.share_grant_id AND issued_at IS NULL AND revoked_at IS NULL
     FOR SHARE
  ) THEN
    RAISE EXCEPTION '発行済みか取り消した共有には範囲を足せません';
  END IF;
  RETURN NEW;
END $$;

-- 共有する記録版。範囲を変えるときは共有を取り消して作り直す
CREATE TABLE app.share_grant_targets (
  tenant_id          uuid NOT NULL,
  share_grant_id     uuid NOT NULL,
  case_id            uuid NOT NULL,
  record_version_id  uuid NOT NULL,
  PRIMARY KEY (share_grant_id, record_version_id),
  FOREIGN KEY (tenant_id, share_grant_id) REFERENCES app.share_grants (tenant_id, id),
  FOREIGN KEY (tenant_id, case_id, record_version_id) REFERENCES app.record_versions (tenant_id, case_id, id)
);

CREATE TRIGGER share_grant_targets_submitted
  BEFORE INSERT ON app.share_grant_targets
  FOR EACH ROW EXECUTE FUNCTION app.require_submitted('record_version_id');
CREATE TRIGGER share_grant_targets_unissued
  BEFORE INSERT ON app.share_grant_targets
  FOR EACH ROW EXECUTE FUNCTION app.require_unissued_share();
CREATE TRIGGER share_grant_targets_fixed
  BEFORE UPDATE OR DELETE ON app.share_grant_targets
  FOR EACH ROW EXECUTE FUNCTION app.reject_change();

-- 共有する版のうち、相手に見せる項目
CREATE TABLE app.share_grant_items (
  tenant_id          uuid NOT NULL,
  share_grant_id     uuid NOT NULL,
  case_id            uuid NOT NULL,
  record_version_id  uuid NOT NULL,
  item_key           text NOT NULL,
  PRIMARY KEY (share_grant_id, record_version_id, item_key),
  FOREIGN KEY (share_grant_id, record_version_id)
    REFERENCES app.share_grant_targets (share_grant_id, record_version_id),
  FOREIGN KEY (tenant_id, case_id, record_version_id, item_key)
    REFERENCES app.record_entries (tenant_id, case_id, record_version_id, item_key)
);

CREATE TRIGGER share_grant_items_unissued
  BEFORE INSERT ON app.share_grant_items
  FOR EACH ROW EXECUTE FUNCTION app.require_unissued_share();
CREATE TRIGGER share_grant_items_fixed
  BEFORE UPDATE OR DELETE ON app.share_grant_items
  FOR EACH ROW EXECUTE FUNCTION app.reject_change();

-- 共有する写真。共有する版に含めた写真に限る
-- マスクを掛けるときは、その写真の消していない注釈（kind = 'mask'）を指す
-- 共有した後にマスクが消されたら、その写真は相手に見せない
CREATE TABLE app.share_grant_media (
  tenant_id           uuid NOT NULL,
  share_grant_id      uuid NOT NULL,
  case_id             uuid NOT NULL,
  record_version_id   uuid NOT NULL,
  media_id            uuid NOT NULL,
  mask_annotation_id  uuid,
  PRIMARY KEY (share_grant_id, record_version_id, media_id),
  FOREIGN KEY (share_grant_id, record_version_id)
    REFERENCES app.share_grant_targets (share_grant_id, record_version_id),
  FOREIGN KEY (tenant_id, case_id, record_version_id, media_id)
    REFERENCES app.record_version_media (tenant_id, case_id, record_version_id, media_id),
  FOREIGN KEY (mask_annotation_id, media_id) REFERENCES app.media_annotations (id, media_id)
);

CREATE FUNCTION app.require_mask() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.mask_annotation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM app.media_annotations
     WHERE id = NEW.mask_annotation_id AND kind = 'mask' AND deleted_at IS NULL
     FOR SHARE
  ) THEN
    RAISE EXCEPTION 'マスクには消していない mask の注釈だけを指定できます';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER share_grant_media_unissued
  BEFORE INSERT ON app.share_grant_media
  FOR EACH ROW EXECUTE FUNCTION app.require_unissued_share();
CREATE TRIGGER share_grant_media_mask
  BEFORE INSERT ON app.share_grant_media
  FOR EACH ROW EXECUTE FUNCTION app.require_mask();
CREATE TRIGGER share_grant_media_fixed
  BEFORE UPDATE OR DELETE ON app.share_grant_media
  FOR EACH ROW EXECUTE FUNCTION app.reject_change();

-- ---------------------------------------------------------------
-- 保存期間と削除（FR-C17）
-- ---------------------------------------------------------------

-- 対象ごとの保存期間。日数は契約前に決める（OQ-003）ので、決まるまでは NULL
CREATE TABLE app.retention_policies (
  tenant_id    uuid NOT NULL REFERENCES app.tenants (id),
  target_kind  text NOT NULL
               CHECK (target_kind IN ('media', 'record', 'personal_copy', 'share', 'audit')),
  retain_days  integer CHECK (retain_days > 0),
  basis        text,  -- 期間の根拠（法令、契約など）
  PRIMARY KEY (tenant_id, target_kind)
);

CREATE TRIGGER retention_policies_columns
  BEFORE UPDATE ON app.retention_policies
  FOR EACH ROW EXECUTE FUNCTION app.allow_columns('retain_days', 'basis');

-- 削除の申請。案件の写真・控えを消すか、社外の人の個人情報を消すかのどちらか
CREATE TABLE app.deletion_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  case_id      uuid,
  party_id     uuid,
  reason       text NOT NULL,
  status       text NOT NULL DEFAULT 'requested'
               CHECK (status IN ('requested', 'on_hold', 'approved', 'rejected', 'executed', 'failed')),
  hold_reason  text,  -- 異議の対応中などで止めている理由
  created_by   uuid NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  decided_by   uuid,
  decided_at   timestamptz,
  executed_at  timestamptz,
  FOREIGN KEY (tenant_id, case_id) REFERENCES app.cases (tenant_id, id),
  FOREIGN KEY (tenant_id, party_id) REFERENCES app.parties (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.staff_members (tenant_id, id),
  FOREIGN KEY (tenant_id, decided_by) REFERENCES app.staff_members (tenant_id, id),
  CHECK (num_nonnulls(case_id, party_id) = 1),
  CHECK ((status = 'on_hold') = (hold_reason IS NOT NULL)),
  CHECK ((decided_by IS NULL) = (decided_at IS NULL)),
  CHECK (status NOT IN ('approved', 'rejected', 'executed', 'failed') OR decided_at IS NOT NULL),
  CHECK ((status = 'executed') = (executed_at IS NOT NULL))
);

CREATE TRIGGER deletion_requests_columns
  BEFORE UPDATE ON app.deletion_requests
  FOR EACH ROW EXECUTE FUNCTION app.allow_columns(
    'status', 'hold_reason', 'decided_by', 'decided_at', 'executed_at');
CREATE TRIGGER deletion_requests_closed
  BEFORE UPDATE ON app.deletion_requests
  FOR EACH ROW WHEN (OLD.status IN ('rejected', 'executed')) EXECUTE FUNCTION app.reject_change();
CREATE TRIGGER deletion_requests_no_delete
  BEFORE DELETE ON app.deletion_requests
  FOR EACH ROW EXECUTE FUNCTION app.reject_change();

-- ---------------------------------------------------------------
-- 検証基準と照合（FR-C09、FR-C10）
-- ---------------------------------------------------------------

-- 提出版の検証基準と、外部（チェーンなど）への登録の状態
CREATE TABLE integrity.anchors (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  case_id            uuid NOT NULL,
  record_version_id  uuid NOT NULL,
  method             text NOT NULL,
  method_version     text NOT NULL,
  -- 登録した内容（記録版と原本のハッシュの一覧）。ハッシュを取り直せるよう、バイト列のまま持つ
  manifest           bytea NOT NULL,
  manifest_hash      text NOT NULL,
  status             text NOT NULL DEFAULT 'unregistered'
                     CHECK (status IN ('unregistered', 'queued', 'sending', 'unknown', 'registered', 'failed')),
  external_ref       text,  -- 登録先での参照（トランザクション ID など）
  registered_at      timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, case_id, id),
  UNIQUE (tenant_id, record_version_id, id),
  UNIQUE (record_version_id, method),
  FOREIGN KEY (tenant_id, case_id, record_version_id) REFERENCES app.record_versions (tenant_id, case_id, id),
  CHECK ((status = 'registered') = (registered_at IS NOT NULL)),
  CHECK (status <> 'registered' OR external_ref IS NOT NULL)
);

CREATE TRIGGER anchors_submitted
  BEFORE INSERT ON integrity.anchors
  FOR EACH ROW EXECUTE FUNCTION app.require_submitted('record_version_id');
CREATE TRIGGER anchors_columns
  BEFORE UPDATE ON integrity.anchors
  FOR EACH ROW EXECUTE FUNCTION app.allow_columns('status', 'external_ref', 'registered_at');
CREATE TRIGGER anchors_registered
  BEFORE UPDATE ON integrity.anchors
  FOR EACH ROW WHEN (OLD.status = 'registered') EXECUTE FUNCTION app.reject_change();
CREATE TRIGGER anchors_no_delete
  BEFORE DELETE ON integrity.anchors
  FOR EACH ROW EXECUTE FUNCTION app.reject_change();

-- 登録と照会の試行。送る前に行を作り、結果が分かったら埋める
-- 再起動しても、結果の分からない試行が残っていれば再送の前に照会できる
CREATE TABLE integrity.anchor_attempts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  case_id          uuid NOT NULL,
  anchor_id        uuid NOT NULL,
  attempt_no       integer NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('submit', 'lookup')),
  idempotency_key  text NOT NULL UNIQUE,
  outcome          text CHECK (outcome IN ('succeeded', 'failed', 'timeout', 'not_found')),
  response         jsonb,  -- 登録先の応答をそのまま残す
  created_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz,
  UNIQUE (anchor_id, attempt_no),
  FOREIGN KEY (tenant_id, case_id, anchor_id) REFERENCES integrity.anchors (tenant_id, case_id, id),
  CHECK ((outcome IS NULL) = (finished_at IS NULL))
);

CREATE TRIGGER anchor_attempts_columns
  BEFORE UPDATE ON integrity.anchor_attempts
  FOR EACH ROW EXECUTE FUNCTION app.allow_columns('outcome', 'response', 'finished_at');
CREATE TRIGGER anchor_attempts_finished
  BEFORE UPDATE ON integrity.anchor_attempts
  FOR EACH ROW WHEN (OLD.finished_at IS NOT NULL) EXECUTE FUNCTION app.reject_change();
CREATE TRIGGER anchor_attempts_no_delete
  BEFORE DELETE ON integrity.anchor_attempts
  FOR EACH ROW EXECUTE FUNCTION app.reject_change();

-- 照合の結果。だれが実行したかは audit.events に残す
-- 基準がない・未登録・原本削除のときは unverifiable にして、一致とは扱わない
CREATE TABLE integrity.verification_runs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  case_id            uuid NOT NULL,
  record_version_id  uuid NOT NULL,
  anchor_id          uuid,
  result             text NOT NULL CHECK (result IN ('match', 'mismatch', 'unverifiable')),
  reason             text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, case_id, record_version_id) REFERENCES app.record_versions (tenant_id, case_id, id),
  -- 照合に使った基準は、同じ記録版のものに限る
  FOREIGN KEY (tenant_id, record_version_id, anchor_id)
    REFERENCES integrity.anchors (tenant_id, record_version_id, id),
  CHECK (anchor_id IS NOT NULL OR result = 'unverifiable'),
  CHECK (result = 'match' OR reason IS NOT NULL)
);

-- 一致・不一致は、登録済みの基準と照らしたときだけ記録できる。登録済みの基準は状態が変わらないので、ロックは要らない
CREATE FUNCTION app.require_registered_anchor() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.result <> 'unverifiable' AND NOT EXISTS (
    SELECT 1 FROM integrity.anchors WHERE id = NEW.anchor_id AND status = 'registered'
  ) THEN
    RAISE EXCEPTION '登録済みの検証基準がない照合は unverifiable にしてください';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER verification_runs_registered
  BEFORE INSERT ON integrity.verification_runs
  FOR EACH ROW EXECUTE FUNCTION app.require_registered_anchor();
CREATE TRIGGER verification_runs_fixed
  BEFORE UPDATE OR DELETE ON integrity.verification_runs
  FOR EACH ROW EXECUTE FUNCTION app.reject_change();

-- ---------------------------------------------------------------
-- 監査履歴（FR-C16）
-- ---------------------------------------------------------------

-- 操作とアクセスの履歴。業務の表で状態が変わった経緯もここに残す
-- 業務の行が消えても履歴は残すため、この表だけは外部キーを張らない
CREATE TABLE audit.events (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id         uuid,  -- 提供側だけの操作は NULL
  created_at        timestamptz NOT NULL DEFAULT now(),
  actor_type        text NOT NULL CHECK (actor_type IN ('staff', 'participant', 'operator', 'system')),
  actor_id          uuid,
  acting_as         text,  -- 代理入力やサポートアクセスのときの資格
  support_grant_id  uuid,
  action            text NOT NULL,
  target_type       text NOT NULL,
  target_id         uuid,
  result            text NOT NULL CHECK (result IN ('succeeded', 'denied', 'failed')),
  request_key       uuid,  -- 同じリクエストの行をまとめるためのキー
  details           jsonb NOT NULL DEFAULT '{}',  -- 変更前後の値など。パスワードやトークンは入れない
  -- 1つ前の行のハッシュをつなぐための列。連結を入れるかは決めておらず、DB では連結を確かめていない
  prev_hash         text,
  entry_hash        text NOT NULL,
  CHECK ((actor_type = 'system') = (actor_id IS NULL))
);

CREATE INDEX events_tenant_time ON audit.events (tenant_id, created_at);
CREATE INDEX events_target ON audit.events (target_type, target_id);

CREATE TRIGGER events_append_only
  BEFORE UPDATE OR DELETE ON audit.events
  FOR EACH ROW EXECUTE FUNCTION app.reject_change();

-- ---------------------------------------------------------------
-- TRUNCATE を止める
-- ---------------------------------------------------------------

-- 行のトリガーは TRUNCATE では動かないので、すべての表に文のトリガーを付ける
-- 表を足したマイグレーションでも同じトリガーを付ける（test/rules.sql で確かめる）
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT n.nspname, c.relname
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind = 'r' AND n.nspname IN ('app', 'integrity', 'audit')
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I.%I '
                   'FOR EACH STATEMENT EXECUTE FUNCTION app.reject_change()',
                   t.relname || '_no_truncate', t.nspname, t.relname);
  END LOOP;
END $$;
