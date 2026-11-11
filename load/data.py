"""Deterministic data plan, PostgreSQL loader and isolated environment probes."""
import argparse
import concurrent.futures
import hashlib
import http.cookiejar
import io
import json
import os
import random
import ssl
import struct
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid
import zlib
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

from PIL import Image, ImageDraw
from PIL.TiffImagePlugin import IFDRational

STATE = Path("/state")
CERTS = Path("/test-certs")
FIREBASE = "http://firebase-auth:9099"
PROJECT = "demo-mobile-tracer-load"
MOCK = "https://mock-tapyrus:8443"
KINDS = ("rental", "dealer", "repair")
STATUSES = ("approved", "pending", "rejected", "held", "expired", "corrected")
POSITIONS = ["正面", "右前", "右後", "後面", "左後", "左前"]


def stable(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def fixture_id(config, label):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"mobile-tracer-load/{config['dataset']}/{config['seed']}/{label}"))


def load_config(size):
    cfg = json.loads(Path(f"/work/config/{size}.json").read_text())
    if not isinstance(cfg["dataset"], str) or not cfg["dataset"].isascii() or not cfg["dataset"].isalnum() or len(cfg["dataset"]) > 24:
        raise ValueError("dataset must be 1–24 ASCII alphanumeric characters")
    limits = {"seed": (0, 2**32-1), "companies": (1, 1000), "customers": (2, 100000),
              "vehicles": (1, 100000), "cases": (1, 100000), "stores_per_company": (1, 20),
              "admins_per_company": (1, 20), "managers_per_store": (1, 20), "staff_per_store": (1, 20),
              "events_per_case": (0, 30), "records_per_case": (1, 20), "versions_per_record": (1, 10),
              "customer_event_percent": (0, 100), "photo_percent": (0, 100), "hot_percent": (0, 100),
              "photos_per_version": (1, 20), "photo_bytes": (1024, 10 << 20), "reserved": (0, cfg["cases"] - 1)}
    for key, (low, high) in limits.items():
        if type(cfg[key]) is not int or not low <= cfg[key] <= high:
            raise ValueError(f"{key}: expected integer in [{low}, {high}]")
    if min(cfg["vehicles"], cfg["cases"]) < cfg["companies"] or cfg["photo_format"] not in {"jpeg", "png", "webp"}:
        raise ValueError("ensure every company has a vehicle and use jpeg, png or webp")
    if cfg.get("image_mode") not in {"metadata", "real"}:
        raise ValueError("image_mode must be metadata or real")
    for key, names in (("business_percent", KINDS), ("start_percent", STATUSES)):
        weights = cfg[key]
        if set(weights) != set(names) or any(type(n) is not int or n < 0 for n in weights.values()) or sum(weights.values()) != 100:
            raise ValueError(f"{key}: percentages must have the defined keys and sum to 100")
    ref = datetime.fromisoformat(cfg["reference_time"])
    if ref.utcoffset() is None or ref.microsecond:
        raise ValueError("reference_time must have a timezone and whole seconds")
    if cfg["photo_format"] == "webp" and cfg["photo_bytes"] % 2:
        raise ValueError("WebP image size must be even")
    return cfg


def plan(cfg):
    ident = lambda label: fixture_id(cfg, label)
    prefix = cfg["dataset"].lower()
    rng = random.Random(cfg["seed"])
    companies, stores, staff, customers, vehicles, cases, events, records = ([] for _ in range(8))
    for i in range(cfg["customers"]):
        customers.append({"id": ident(f"customer/{i}"), "email": f"{prefix}-customer-{i}@load.example"})
    for i in range(cfg["companies"]):
        company = {"id": ident(f"company/{i}"), "config": ident(f"config/{i}"), "name": f"Load company {i}"}
        companies.append(company)
        for j in range(cfg["stores_per_company"]):
            store = {"id": ident(f"store/{i}/{j}"), "tenant": company["id"], "name": f"Load store {i}/{j}"}
            stores.append(store)
            for role, count in (("store_manager", cfg["managers_per_store"]), ("staff", cfg["staff_per_store"])):
                for k in range(count):
                    index = len(staff)
                    staff.append({"id": ident(f"staff/{index}"), "user": ident(f"staff-user/{index}"),
                                  "email": f"{prefix}-staff-{index}@load.example", "tenant": company["id"],
                                  "store": store["id"], "role": role})
            store["manager"], store["staff"] = staff[-cfg["staff_per_store"] - cfg["managers_per_store"]], staff[-1]
        for _ in range(cfg["admins_per_company"]):
            index = len(staff)
            staff.append({"id": ident(f"staff/{index}"), "user": ident(f"staff-user/{index}"),
                          "email": f"{prefix}-staff-{index}@load.example", "tenant": company["id"],
                          "store": None, "role": "tenant_admin"})
        company["admin"] = staff[-cfg["admins_per_company"]]["id"]
    for i in range(cfg["vehicles"]):
        vehicles.append({"id": ident(f"vehicle/{i}"), "tenant": companies[i % len(companies)]["id"],
                         "name": f"Load vehicle {i}"})
    vehicle_groups = {row["id"]: [] for row in companies}
    for vehicle in vehicles:
        vehicle_groups[vehicle["tenant"]].append(vehicle)
    for i in range(cfg["cases"]):
        company_index = i % len(companies)
        company = companies[company_index]
        store = stores[company_index * cfg["stores_per_company"] + (i // len(companies)) % cfg["stores_per_company"]]
        customer = customers[i % len(customers)]
        manager, worker = store["manager"], store["staff"]
        state = "reserved" if i < cfg["reserved"] else rng.choices(STATUSES, [cfg["start_percent"][key] for key in STATUSES])[0]
        kind = rng.choices(KINDS, [cfg["business_percent"][key] for key in KINDS])[0]
        case = {"id": ident(f"case/{i}"), "tenant": company["id"], "store": store["id"],
                "customer": customer["id"], "staff": worker["id"], "actor": worker["user"],
                "config": company["config"], "state": state, "kind": kind,
                "vehicle": rng.choice(vehicle_groups[company["id"]])["id"], "ordinal": i,
                "manager_email": manager["email"], "staff_email": worker["email"], "customer_email": customer["email"],
                "start": ident(f"start/{i}/1")}
        cases.append(case)
        if state != "approved":
            continue
        for j in range(cfg["events_per_case"]):
            event_kind = ("request" if j % 2 == 0 else "incident") if rng.randrange(100) < cfg["customer_event_percent"] else ("work" if j % 2 == 0 else "progress_report")
            events.append({"id": ident(f"event/{i}/{j}"), "case": case["id"], "kind": event_kind, "ordinal": j})
        for j in range(cfg["records_per_case"]):
            record = {"id": ident(f"record/{i}/{j}"), "case": case["id"], "photos": rng.randrange(100) < cfg["photo_percent"]}
            records.append(record)
            if j == 0:
                case["sample_version"] = derived(record["id"], "version:1")
                if record["photos"]:
                    case["sample_media"] = derived(case["sample_version"], "photo:1")
    return dict(companies=companies, stores=stores, staff=staff, customers=customers, vehicles=vehicles,
                cases=cases, events=events, records=records)


def derived(ident, suffix):
    return str(uuid.UUID(hashlib.md5(f"{ident}:{suffix}".encode(), usedforsecurity=False).hexdigest()))


def estimate(cfg, fixture):
    states = Counter(case["state"] for case in fixture["cases"])
    approvals = states["approved"]
    starts = cfg["cases"] - states["reserved"] + states["corrected"]
    responses = sum(states[key] for key in ("approved", "rejected", "held", "corrected"))
    event_count = len(fixture["events"])
    completions = sum(event["kind"] != "progress_report" for event in fixture["events"])
    photo_records = sum(record["photos"] for record in fixture["records"])
    photo_cases = len({record["case"] for record in fixture["records"] if record["photos"]})
    presented = photo_records * cfg["versions_per_record"]
    versions = len(fixture["records"]) - photo_records + presented
    photos = presented * cfg["photos_per_version"]
    tables = {"app.tenants": len(fixture["companies"]), "app.stores": len(fixture["stores"]),
              "app.staff_members": len(fixture["staff"]), "app.staff_role_assignments": len(fixture["staff"]),
              "auth.users": len(fixture["staff"]) + len(fixture["customers"]), "auth.staff_links": len(fixture["staff"]),
              "app.configuration_versions": len(fixture["companies"]), "app.business_templates": 3,
              "app.configuration_modules": 3 * len(fixture["companies"]), "app.vehicles": len(fixture["vehicles"]),
              "app.cases": len(fixture["cases"]), "app.case_start_requests": starts, "app.case_start_responses": responses,
              "app.case_events": event_count, "app.case_event_actions": event_count + 3 * completions,
              "app.records": len(fixture["records"]), "app.record_versions": versions, "app.record_entries": versions,
              "app.workflow_media": photos, "app.workflow_presentations": presented, "app.workflow_requests": presented,
              "app.workflow_responses": photo_records, "app.workflow_anchors": photo_records,
              "integrity.api_registrations": approvals + event_count + completions + photo_records,
              "load_fixture.dataset": 1,
              "audit.events": starts + responses + 2 * event_count + 3 * completions + presented + photo_records}
    other = sum(tables.values()) * 1536
    logical_image_bytes = photos * cfg["photo_bytes"]
    stored_photo_bytes = cfg["photo_bytes"] if cfg["image_mode"] == "real" else 16384
    stored_image_bytes = photos * stored_photo_bytes
    with_indexes = (other + stored_image_bytes) * 3 // 2
    return dict(tables=tables, states=dict(states), firebase_users=tables["auth.users"], photos=photos,
                cases=cfg["cases"], photo_cases=photo_cases,
                photos_per_photo_case=photos / photo_cases if photo_cases else 0,
                photos_per_all_case=photos / cfg["cases"], image_mode=cfg["image_mode"],
                photo_bytes=logical_image_bytes, stored_photo_bytes=stored_image_bytes,
                bytes_per_photo=cfg["photo_bytes"], stored_bytes_per_photo=stored_photo_bytes,
                other_db_bytes=other, db_with_indexes_bytes=with_indexes,
                db_wal_temp_bytes=with_indexes * 3, recommended_free_bytes=(2 << 30) + with_indexes * 4,
                assumptions="1.5 KiB/row, 50% index/TOAST overhead, 3x for WAL/temp, 2 GiB build-cache baseline. metadata mode stores 16 KiB decodable proxies and does not measure image I/O.")


def image(fmt, size, seed):
    if fmt == "jpeg":
        width, height = ((4032, 3024) if size >= 500000 else (640, 480))
        base = Image.new("RGB", (1008, 756))
        draw = ImageDraw.Draw(base)
        rng = random.Random(seed)
        for y in range(756):
            draw.line((0, y, 1008, y), fill=(55 + y * 80 // 756, 90 + y * 70 // 756, 120 + y * 60 // 756))
        draw.rectangle((90, 330, 920, 650), fill=(39, 48, 57), outline=(210, 218, 224), width=5)
        draw.polygon(((170, 420), (300, 300), (750, 300), (860, 430)), fill=(88, 112, 132))
        for x in (205, 790):
            draw.ellipse((x - 80, 565, x + 80, 725), fill=(20, 22, 25), outline=(150, 155, 160), width=8)
        for _ in range(1800):
            x, y = rng.randrange(1008), rng.randrange(756)
            color = rng.randrange(35, 220)
            draw.point((x, y), fill=(color, min(255, color + 12), max(0, color - 8)))
        base = base.resize((width, height), Image.Resampling.BICUBIC)
        exif = Image.Exif()
        exif[306] = exif[36867] = exif[36868] = "2026:01:01 08:00:00"
        exif[34853] = {1: "N", 2: (IFDRational(35), IFDRational(0), IFDRational(0)),
                       3: "E", 4: (IFDRational(139), IFDRational(0), IFDRational(0))}
        raw = None
        for quality in range(92, 59, -4):
            output = io.BytesIO()
            base.save(output, "JPEG", quality=quality, subsampling=2, optimize=True, exif=exif)
            if output.tell() <= size - 4:
                raw = output.getvalue()
                break
        if raw is None:
            raise ValueError("JPEG size is too small for the selected dimensions and EXIF")
        gap = size - len(raw)
        segments = (gap + 65536) // 65537
        if gap < segments * 4:
            raise ValueError("JPEG padding is too small")
        rng = random.Random(seed)
        payload_total = gap - segments * 4
        block = bytearray(raw[:2])
        for index in range(segments):
            payload = payload_total // segments + (index < payload_total % segments)
            block.extend(b"\xff\xfe" + struct.pack(">H", payload + 2) + rng.randbytes(payload))
        raw = bytes(block) + raw[2:]
        with Image.open(io.BytesIO(raw)) as decoded:
            decoded.load()
            if decoded.size != (width, height) or decoded.getexif().get(36867) is None:
                raise ValueError("JPEG dimensions or EXIF were not preserved")
        return raw
    output = io.BytesIO()
    Image.new("RGB", (24, 24), (71, 93, 118)).save(output, fmt.upper())
    raw = output.getvalue()
    gap = size - len(raw)
    if gap < 16:
        raise ValueError("image size too small")
    rng = random.Random(seed)
    if fmt == "png":
        chunk = b"raNd" + rng.randbytes(gap - 12)
        raw = raw[:-12] + struct.pack(">I", gap - 12) + chunk + struct.pack(">I", zlib.crc32(chunk)) + raw[-12:]
    else:
        if size % 2:
            raise ValueError("WebP image size must be even")
        raw = raw[:4] + struct.pack("<I", size - 8) + raw[8:] + b"JUNK" + struct.pack("<I", gap - 8) + rng.randbytes(gap - 8)
    with Image.open(io.BytesIO(raw)) as decoded:
        decoded.load()
    return raw


def query(sql, *, script=None, variables=None):
    args = ["psql", "-XqAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=terse"]
    for key, val in (variables or {}).items():
        args += ["-v", f"{key}={val}"]
    args += ["-f", str(script)] if script else []
    done = subprocess.run(args, input=None if script else sql, capture_output=True, text=True)
    if done.returncode:
        # PostgreSQL DETAIL can include row values. Only show the terse error and file line.
        raise ValueError(done.stderr.strip().splitlines()[0] if done.stderr else "psql failed")
    return done.stdout.strip()


def request_json(url, body=None, *, headers=None, context=None, opener=None):
    headers = dict(headers or {})
    if body is not None:
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, json.dumps(body).encode() if body is not None else None, headers)
    response = opener.open(request, timeout=15) if opener else urllib.request.urlopen(request, timeout=15, context=context)
    with response:
        return json.load(response)


def firebase_user(user):
    email, ident = user["email"], user.get("user", user["id"])
    url = f"{FIREBASE}/identitytoolkit.googleapis.com/v1/projects/{PROJECT}/accounts"
    body = {"localId": ident, "email": email, "emailVerified": True,
            "password": os.environ["LOAD_USER_PASSWORD"], "displayName": email.split("@")[0]}
    try:
        created = request_json(url, body, headers={"Authorization": "Bearer owner"})
        if created.get("localId") != ident:
            raise ValueError("Firebase UID differs from deterministic fixture")
    except urllib.error.HTTPError as error:
        if error.code not in (400, 409):
            raise ValueError(f"Firebase create failed: HTTP {error.code}") from None
        sign_in = request_json(FIREBASE + "/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key",
                       {"email": email, "password": body["password"], "returnSecureToken": True})
        if sign_in.get("localId") != ident:
            raise ValueError("Existing Firebase account UID differs from fixture")


def write_json(path, data):
    tmp = path.with_suffix(".tmp")
    with tmp.open("w") as stream:
        os.chmod(tmp, 0o600)
        stream.write(stable(data) + "\n")
    tmp.replace(path)


def write_upload_images(size, seed):
    for index in range(20):
        (STATE / f"upload-{index + 1:02}.jpeg").write_bytes(image("jpeg", size, seed + index))


def seed(cfg, fixture):
    seed_sql = Path("/work/seed.sql").read_text()
    sql_digest = sha(seed_sql.encode())
    generator_digest = sha(Path("/work/data.py").read_bytes())
    digest = sha(stable({"config": cfg, "sql_sha256": sql_digest, "generator_sha256": generator_digest}).encode())
    table = query("SELECT to_regclass('load_fixture.dataset')")
    previous = query("SELECT digest FROM load_fixture.dataset") if table else ""
    if previous and previous != digest:
        raise ValueError("Dedicated DB contains different fixture conditions; use reset before reseeding")
    if not previous and query("SELECT current_database()='mobile_tracer_load' AND NOT EXISTS(SELECT FROM app.tenants)") != "t":
        raise ValueError("A fresh dedicated database is required")
    now = datetime.now(timezone.utc)
    ref = datetime.fromisoformat(cfg["reference_time"])
    if not ref + timedelta(hours=1) <= now < ref + timedelta(days=365):
        raise ValueError("reference_time must be at least one hour and less than 365 days before seeding")
    stored_bytes = cfg["photo_bytes"] if cfg["image_mode"] == "real" else 16384
    photo = image(cfg["photo_format"], stored_bytes, cfg["seed"])
    start = time.monotonic()
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as executor:
        for _ in executor.map(firebase_user, fixture["customers"] + fixture["staff"]):
            pass
    auth_seconds = time.monotonic() - start
    start = time.monotonic()
    if not previous:
        payload = dict(config=cfg, digest=digest, photo=photo.hex(), **fixture)
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / "fixture.json"
            # PostgreSQL COPY text format escapes backslashes.
            file.write_text(stable(payload).replace("\\", "\\\\") + "\n")
            sql = Path(directory) / "seed.sql"
            sql.write_text(seed_sql.replace("@FIXTURE_FILE@", str(file)))
            query(None, script=sql)
    usable = [case for case in fixture["cases"] if case["state"] != "reserved"]
    dataset = {"id": cfg["dataset"], "seed": cfg["seed"], "digest": digest, "sql_sha256": sql_digest,
               "generator_sha256": generator_digest, "image_mode": cfg["image_mode"],
               "photo_format": cfg["photo_format"], "cases": cfg["cases"],
               "customers": cfg["customers"], "hot_percent": cfg["hot_percent"], "estimate": estimate(cfg, fixture)}
    write_json(STATE / "dataset.json", dataset)
    write_json(STATE / "fixture-targets.json", {"read": usable, "write": fixture["cases"][:cfg["reserved"]],
                                       "photo_mime": "image/" + cfg["photo_format"], "photo_bytes": stored_bytes,
                                       "photo_base_sha256": sha(photo), "hot_percent": cfg["hot_percent"]})
    write_upload_images(cfg["photo_bytes"], cfg["seed"] + 1)
    print(stable(dict(dataset=dataset, reused=bool(previous), firebase_seconds=auth_seconds,
                      postgres_seconds=time.monotonic() - start)))


def mock(path):
    tls = ssl.create_default_context(cafile=str(CERTS / "ca.crt"))
    tls.load_cert_chain(CERTS / "client.crt", CERTS / "client.key")
    return request_json(MOCK + path, headers={"Authorization": "Bearer " + (CERTS / "token").read_text().strip()},
                context=tls)


def prepare(scenario):
    targets = json.loads((STATE / "fixture-targets.json").read_text())
    media_ids = [str(uuid.UUID(case["sample_media"])) for case in targets["read"] if case.get("sample_media")]
    if media_ids:
        rows = query(f"""
          BEGIN;
          CREATE TEMP TABLE requested_media(id uuid PRIMARY KEY) ON COMMIT DROP;
          COPY requested_media(id) FROM STDIN;
{chr(10).join(media_ids)}
\\.
          SELECT m.id||'|'||m.sha256 FROM app.workflow_media m JOIN requested_media r ON r.id=m.id;
          COMMIT;
        """).splitlines()
        hashes = dict(row.split("|", 1) for row in rows)
        for case in targets["read"]:
            if case.get("sample_media"):
                case["sample_media_sha256"] = hashes.get(case["sample_media"])
    reserved = {case["id"] for case in targets["write"]}
    if reserved:
        ids = [str(uuid.UUID(ident)) for ident in sorted(reserved)]
        copy_rows = "\n".join(ids)
        available = set(query(f"""
          BEGIN;
          CREATE TEMP TABLE requested_cases(id uuid PRIMARY KEY) ON COMMIT DROP;
          COPY requested_cases(id) FROM STDIN;
{copy_rows}
\\.
          SELECT c.id FROM app.cases c JOIN requested_cases r ON r.id=c.id
          WHERE c.status='awaiting_customer'
          AND NOT EXISTS(SELECT FROM app.case_start_requests WHERE case_id=c.id);
          COMMIT;
        """).splitlines())
        targets["write"] = [case for case in targets["write"] if case["id"] in available]
    if scenario in ("write", "images", "registration", "conflict", "mixed") and not targets["write"]:
        raise ValueError("No untouched write targets; reset and reseed")
    write_json(STATE / "targets.json", targets)


def probe():
    with urllib.request.urlopen("http://nginx:8080/login", timeout=10) as response:
        if response.status != 200 or b"</html>" not in response.read():
            raise ValueError("SSR login page did not respond")
    if request_json("http://nginx:8080/api/ready") != {"status": "ok"}:
        raise ValueError("API not ready")
    request_json(FIREBASE + "/")
    mock("/metrics")
    tls = ssl.create_default_context(cafile=str(CERTS / "ca.crt"))
    try:
        request_json(MOCK + "/metrics", context=tls)
    except (ssl.SSLError, urllib.error.URLError, ConnectionError):
        pass
    else:
        raise ValueError("Mock accepted a request without a client certificate")
    tls.load_cert_chain(CERTS / "client.crt", CERTS / "client.key")
    try:
        request_json(MOCK + "/metrics", context=tls)
    except urllib.error.HTTPError as error:
        if error.code != 401:
            raise
    else:
        raise ValueError("Mock accepted a request without Bearer authorization")
    print("SSR, API, Firebase and Timestamp V2 mTLS: OK")


def stats():
    sql = """
    SELECT json_build_object(
      'db_bytes',pg_database_size(current_database()),
      'tables',(SELECT json_object_agg(schemaname||'.'||relname,pg_total_relation_size(relid))
        FROM pg_stat_user_tables),
      'connections',(SELECT json_build_object('total',count(*),'active',count(*) FILTER(WHERE state='active'),
        'lock_wait',count(*) FILTER(WHERE wait_event_type='Lock'),'waiting',count(*) FILTER(WHERE wait_event_type IS NOT NULL AND state='active'))
        FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()),
      'transactions',(SELECT json_build_object('commits',xact_commit,'rollbacks',xact_rollback,'deadlocks',deadlocks,
        'blocks_read',blks_read,'cache_hits',blks_hit) FROM pg_stat_database WHERE datname=current_database()),
      'media',(SELECT json_build_object('count',count(*),'bytes',coalesce(sum(octet_length(bytes)),0)) FROM app.workflow_media),
      'queue',(SELECT coalesce(json_object_agg(status,n),'{}'::json) FROM
        (SELECT status,count(*) n FROM integrity.api_registrations GROUP BY status) s),
      'oldest_queue_seconds',(SELECT extract(epoch FROM now()-min(created_at)) FROM integrity.api_registrations WHERE status='queued'),
      'confirmed_total',(SELECT count(*) FROM integrity.api_registrations WHERE status='confirmed'));
    """
    result = json.loads(query(sql))
    result["mock"] = mock("/metrics")
    return result


def explain_history():
    user_id = str(uuid.UUID(query("""
      SELECT actor_id FROM audit.events
      WHERE actor_type='user' AND target_id IS NOT NULL ORDER BY created_at LIMIT 1
    """)))
    raw = query(f"""
      EXPLAIN (ANALYZE, BUFFERS, WAL, SETTINGS, FORMAT JSON)
      WITH scoped AS (
        SELECT CASE WHEN target_type='record' THEN 'record_version' ELSE target_type END AS target_type,
          CASE WHEN target_type='record' THEN details->>'version_id' ELSE target_id::text END AS target_id,
          action,details,created_at,id,
          EXISTS(SELECT 1 FROM auth.management_requests r WHERE r.id=e.target_id AND r.requester_id='{user_id}') AS own_application
        FROM audit.events e
        WHERE target_id IS NOT NULL AND result='succeeded'
          AND target_type IN ('record','record_version','case','management_request')
          AND (action LIKE 'transaction.%' OR action LIKE 'case.%' OR action LIKE 'record.%' OR
               action LIKE 'draft.%' OR action LIKE 'management.request_%')
          AND ((actor_type='user' AND actor_id='{user_id}') OR
            (actor_type='staff' AND EXISTS(SELECT 1 FROM auth.staff_links l WHERE l.staff_id=e.actor_id
              AND l.tenant_id=e.tenant_id AND l.user_id='{user_id}' AND l.revoked_at IS NULL)) OR
            (target_type='management_request' AND EXISTS(SELECT 1 FROM auth.management_requests r
              WHERE r.id=e.target_id AND r.requester_id='{user_id}')))
      ), ranked AS (
        SELECT *,row_number() OVER (PARTITION BY target_type,target_id ORDER BY created_at DESC,id DESC) AS position
        FROM scoped WHERE target_id IS NOT NULL
      )
      SELECT * FROM ranked WHERE position=1 ORDER BY created_at DESC,target_type,target_id LIMIT 20;
    """)
    plan_data = json.loads(raw)
    write_json(STATE / "history-explain.json", plan_data)
    plan = plan_data[0]
    print(stable({"file": "/state/history-explain.json", "planning_ms": plan.get("Planning Time"),
                  "execution_ms": plan.get("Execution Time"), "root": plan.get("Plan", {}).get("Node Type")}))


def verify():
    dataset = json.loads((STATE / "dataset.json").read_text())
    tables = dataset["estimate"]["tables"]
    counts = json.loads(query("SELECT json_build_object(" + ",".join(
        f"'{name}',(SELECT count(*) FROM {name}" + (" WHERE details->>'fixture' = 'true'" if name == "audit.events" else "") + ")" for name in tables
    ) + ")"))
    if counts != tables:
        raise ValueError("Fixture table counts differ from the initial plan; verify before performing updates")
    invalid = query("""
      SELECT (SELECT count(*) FROM app.workflow_media WHERE sha256<>encode(sha256(bytes),'hex')) +
       (SELECT count(*) FROM integrity.api_registrations WHERE manifest_hash<>encode(sha256(manifest),'hex')) +
       (SELECT count(*) FROM app.cases c WHERE status='in_progress' AND NOT EXISTS (
        SELECT FROM app.case_start_requests q JOIN app.case_start_responses r ON r.request_id=q.id
        WHERE q.case_id=c.id AND r.decision='approved' AND r.actor_id=q.customer_id AND r.created_at<=q.deadline)) +
       (SELECT count(*) FROM integrity.api_registrations a JOIN app.case_start_requests q ON q.id=a.subject_id
        LEFT JOIN app.case_start_responses r ON r.request_id=q.id
        WHERE a.subject_type='case_start' AND r.decision IS DISTINCT FROM 'approved') +
       (SELECT count(*) FROM app.case_event_actions a JOIN app.case_events e ON e.id=a.event_id
        JOIN app.cases c ON c.id=e.case_id WHERE c.status<>'in_progress') +
       (SELECT count(*) FROM integrity.api_registrations a LEFT JOIN app.workflow_anchors h ON h.version_id=a.subject_id
        WHERE a.subject_type='record' AND (h.version_id IS NULL OR a.manifest_hash<>h.manifest_hash)) +
       (SELECT count(*) FROM app.workflow_responses r JOIN app.workflow_requests q ON q.id=r.request_id
        JOIN app.record_versions v ON v.id=q.version_id WHERE r.actor_id<>q.user_id OR r.created_at>q.deadline OR v.version_no<>1) +
       (SELECT count(*) FROM app.record_versions v WHERE v.status='submitted' AND (
        jsonb_typeof(v.vehicle_snapshot)<>'object' OR NOT (v.vehicle_snapshot ?& ARRAY['id','model_name','created_at','identifiers']) OR
        jsonb_typeof(v.vehicle_snapshot->'identifiers')<>'array')) +
       (SELECT count(*) FROM app.workflow_presentations p WHERE
        jsonb_typeof(convert_from(p.content,'UTF8')::jsonb->'vehicle')<>'object' OR
        jsonb_typeof(convert_from(p.content,'UTF8')::jsonb->'vehicle'->'identifiers')<>'array') +
       (SELECT count(*)-count(DISTINCT sha256) FROM app.workflow_media)
    """)
    if invalid != "0":
        raise ValueError("Fixture relationship or hash invariant failed")
    case_fingerprint = query("""
      SELECT encode(sha256(convert_to(string_agg(c.id::text || ':' || c.status || ':' ||
        coalesce(q.terms_hash,'') || ':' || coalesce(r.decision,''),',' ORDER BY c.id),'UTF8')),'hex')
      FROM app.cases c LEFT JOIN LATERAL
        (SELECT * FROM app.case_start_requests WHERE case_id=c.id ORDER BY version_no DESC LIMIT 1) q ON true
      LEFT JOIN app.case_start_responses r ON r.request_id=q.id
    """)
    other_fingerprint = query("""
      WITH rows AS (
        SELECT id::text||':'||coalesce(content_hash,'draft') AS material FROM app.record_versions
        UNION ALL SELECT id::text||':'||sha256 FROM app.workflow_media
        UNION ALL SELECT id::text||':'||manifest_hash FROM integrity.api_registrations
      )
      SELECT encode(sha256(convert_to(coalesce(string_agg(material,',' ORDER BY material COLLATE "C"),''),'UTF8')),'hex') FROM rows
    """)
    fingerprint = sha((case_fingerprint + other_fingerprint).encode())
    write_json(STATE / "verification.json", {"dataset_digest": dataset["digest"], "fingerprint": fingerprint})
    print(stable({"tables": counts, "fingerprint": fingerprint, "stats": stats()}))


def verify_case(case_id, job_id, email):
    login = request_json(FIREBASE + "/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key",
                         {"email": email, "password": os.environ["LOAD_USER_PASSWORD"], "returnSecureToken": True})
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    base = "http://nginx:8080"
    host = "localhost:" + os.environ["LOAD_HTTP_PORT"]
    headers = {"Host": host, "Origin": "http://" + host}
    challenge = request_json(base + "/api/auth/login-challenge", headers=headers, opener=opener)
    request_json(base + "/api/auth/session", {"id_token": login["idToken"]},
                 headers={**headers, "X-CSRF-Token": challenge["data"]["csrf_token"]}, opener=opener)
    me = request_json(base + "/api/auth/me", headers=headers, opener=opener)
    result = request_json(base + f"/api/casework/{case_id}/verify/{job_id}", {},
                          headers={**headers, "X-CSRF-Token": me["data"]["csrf_token"]}, opener=opener)
    if result.get("data", {}).get("result") != "match":
        raise ValueError("Casework verification did not match the mock registration")
    return "match"


def registration(mode):
    deadline = time.monotonic() + 120
    fixture = json.loads((STATE / "fixture-targets.json").read_text())
    ids = ",".join(f"'{uuid.UUID(case['id'])}'" for case in fixture["write"])
    if not ids:
        raise ValueError("No registration test target")
    target = query(f"""
      SELECT json_build_object('job',a.id,'case',q.case_id,'email',u.email)
      FROM integrity.api_registrations a JOIN app.case_start_requests q ON q.id=a.subject_id
      JOIN auth.users u ON u.id=q.customer_id
      WHERE a.subject_type='case_start' AND q.case_id IN ({ids}) ORDER BY q.created_at DESC LIMIT 1
    """)
    if not target:
        raise ValueError("Run the registration scenario before checking the queue")
    target = json.loads(target)
    job = uuid.UUID(target["job"])
    mode_status = {"lost-hidden": "unknown", "reject": "failed", "server-error": "unknown"}
    wanted = mode_status.get(mode, "confirmed")
    while time.monotonic() < deadline:
        current = stats()
        if current["mock"]["duplicates"] != 0:
            raise ValueError("Mock observed duplicate POST")
        row = json.loads(query(f"""
          SELECT json_build_object('state',a.status,'timestamp_id',a.timestamp_id,'hash',a.manifest_hash,
            'actions',(SELECT json_agg(replace(action,'transaction.anchor.','') ORDER BY id) FROM audit.events
                       WHERE target_id=a.subject_id AND action LIKE 'transaction.anchor.api.%'))
          FROM integrity.api_registrations a WHERE a.id='{job}'
        """))
        actions = row["actions"] or []
        recovered = mode != "lost" or "api.unknown" in actions
        looked_up = mode != "lost-hidden" or actions.count("api.unknown") >= 3
        if row["state"] == wanted and recovered and looked_up:
            if row["timestamp_id"] is not None:
                stamp = mock("/api/v2/timestamps/" + str(row["timestamp_id"]))
                if stamp["status"] != wanted or stamp["content_hash"] != row["hash"]:
                    raise ValueError("Mock lookup does not match the registered manifest")
                row["casework_verification"] = verify_case(target["case"], job, target["email"])
            print(stable(dict(job=row, mock=mock("/metrics"))))
            return
        time.sleep(2)
    raise ValueError("Registration did not reach the expected state in 120 seconds; check backlog and mock mode")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("estimate", "seed", "verify", "probe", "stats", "image", "registration", "prepare", "history-plan"))
    parser.add_argument("argument", nargs="?")
    parser.add_argument("mode", nargs="?", choices=("metadata", "real"))
    args = parser.parse_args()
    if args.command in ("estimate", "seed"):
        cfg = load_config(args.argument)
        if args.mode:
            cfg["image_mode"] = args.mode
        fixture = plan(cfg)
        if args.command == "estimate":
            print(json.dumps(estimate(cfg, fixture), ensure_ascii=False, indent=2))
        else:
            seed(cfg, fixture)
    elif args.command == "stats":
        print(stable(stats()))
    elif args.command == "image":
        write_upload_images(int(args.argument), 77)
    elif args.command == "prepare":
        prepare(args.argument)
    elif args.command == "registration":
        registration(args.argument)
    elif args.command == "history-plan":
        explain_history()
    else:
        {"verify": verify, "probe": probe}[args.command]()


if __name__ == "__main__":
    os.umask(0o077)
    try:
        main()
    except urllib.error.HTTPError as error:
        sys.exit(f"HTTP {error.code} from isolated service")
    except (OSError, ValueError) as error:
        sys.exit(str(error))
