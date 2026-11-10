"""Host-side entry point. All Docker access is scoped to a local daemon and fixed project."""
import argparse
import fcntl
import json
import os
import re
import secrets
import shutil
import socket
import stat
import subprocess
import sys
import tempfile
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROJECT = "mobile-tracer-load"
ENV = ROOT / ".env.load"
KEYS = ROOT / "load/credentials"
STATE = ROOT / "load/state"
RESULTS = ROOT / "load/results"
os.chdir(ROOT)
os.umask(0o077)
PROCESS_ENV = {"PATH": "/usr/local/bin:/usr/bin:/bin", "LANG": "C.UTF-8"}
DOCKER = ["docker", "--host", "unix:///var/run/docker.sock"]
COMPOSE = DOCKER + ["compose", "--project-name", PROJECT, "--env-file", str(ENV),
                    "--file", "compose.load.yaml"]


def run(args, *, capture=False, check=True, quiet=False):
    return subprocess.run(args, env=PROCESS_ENV, check=check, text=True,
                          stdout=subprocess.PIPE if capture else None,
                          stderr=subprocess.DEVNULL if quiet else None)


def safe(path):
    if path.resolve() != path:
        raise ValueError(f"シンボリックリンクは使用できません: {path.relative_to(ROOT)}")


def private(path, mode):
    safe(path)
    info = path.stat()
    expected = stat.S_ISDIR if mode == 0o700 else stat.S_ISREG
    if not expected(info.st_mode) or stat.S_IMODE(info.st_mode) != mode or info.st_uid != os.getuid():
        raise ValueError(f"所有者と権限 {mode:o} を確認してください: {path.relative_to(ROOT)}")


def private_dir(path):
    safe(path)
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    private(path, 0o700)


def read_env(path):
    safe(path)
    values = {}
    for line in path.read_text().splitlines():
        if not line or line.startswith("#"):
            continue
        match = re.fullmatch(r"([A-Z_]+)=([a-z0-9.-]+)", line)
        if not match or match[1] in values:
            raise ValueError("負荷試験の設定形式が不正です。値は表示していません")
        values[match[1]] = match[2]
    return values


EXAMPLE = ROOT / ".env.load.example"
GENERATED = {"LOAD_UID", "LOAD_GID", "LOAD_DB_PASSWORD", "LOAD_USER_PASSWORD"}
MODES = {"normal", "reject", "server-error", "lost", "lost-hidden", "mismatch"}


def openssl(*args):
    result = run(["openssl", *map(str, args)], capture=True, check=False, quiet=True)
    if result.returncode:
        raise ValueError("試験証明書を検証できません。負荷環境を停止し、load/credentials を退避して init を再実行してください")
    return result.stdout


def init():
    if not os.getuid():
        raise ValueError('init は一般ユーザーで実行してください')
    for path in (KEYS, STATE, STATE / "mock", RESULTS, ENV):
        safe(path)
    if not KEYS.exists():
        KEYS.parent.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix=".load-", dir=KEYS.parent) as directory:
            tmp = Path(directory)
            client, server = tmp / "client", tmp / "server"
            client.mkdir()
            server.mkdir()
            ca_key, ca_cert = tmp / "ca.key", tmp / "ca.crt"
            openssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "365",
                    "-subj", "/CN=mobile-tracer-load CA", "-keyout", ca_key, "-out", ca_cert)
            for name, dest, usage in (("client", client, "clientAuth"), ("server", server, "serverAuth")):
                req, ext = tmp / f"{name}.csr", tmp / f"{name}.ext"
                ext.write_text(f"extendedKeyUsage={usage}\n" + ("subjectAltName=DNS:mock-tapyrus\n" if name == "server" else ""))
                openssl("req", "-new", "-newkey", "rsa:2048", "-nodes", "-subj", f"/CN=load-{name}",
                        "-keyout", dest / f"{name}.key", "-out", req)
                openssl("x509", "-req", "-in", req, "-CA", ca_cert, "-CAkey", ca_key,
                        "-CAcreateserial", "-days", "365", "-extfile", ext, "-out", dest / f"{name}.crt")
                shutil.copyfile(ca_cert, dest / "ca.crt")
            token = secrets.token_hex(32)
            for name, dest in (("client", client), ("server", server)):
                (dest / "token").write_text(token + "\n")
                for path in dest.iterdir():
                    path.chmod(0o600)
                (tmp / (name + ".ext")).unlink()
                (tmp / (name + ".csr")).unlink()
            ca_key.unlink()
            ca_cert.unlink()
            (tmp / "ca.srl").unlink()
            tmp.rename(KEYS)
    for path in (STATE, STATE / "mock", RESULTS):
        private_dir(path)
    if not ENV.exists():
        with ENV.open("x") as output:
            for key, value in {**read_env(EXAMPLE), "LOAD_UID": os.getuid(), "LOAD_GID": os.getgid(),
                               "LOAD_DB_PASSWORD": secrets.token_hex(32),
                               "LOAD_USER_PASSWORD": secrets.token_hex(32)}.items():
                output.write(f"{key}={value}\n")
    validate()
    print("負荷試験専用の設定と証明書を確認しました")


def validate():
    private(ENV, 0o600)
    cfg = read_env(ENV)
    if cfg.keys() != read_env(EXAMPLE).keys() | GENERATED:
        raise ValueError(".env.load のキーが設定例と一致しません")
    limits = {"LOAD_HTTP_PORT": (1024, 65535), "LOAD_AUTH_PORT": (1024, 65535),
              "LOAD_API_REPLICAS": (1, 8), "LOAD_API_MEMORY_MIB": (128, 65536),
              "LOAD_DB_CONNECTIONS": (1, 90), "LOAD_MOCK_DELAY_MS": (0, 60000),
              "LOAD_CONFIRM_SECONDS": (0, 86400)}
    for key, (low, high) in limits.items():
        if not cfg[key].isdigit() or not low <= int(cfg[key]) <= high:
            raise ValueError(f"{key} は {low}〜{high} の整数にしてください")
    if cfg["LOAD_HTTP_PORT"] == cfg["LOAD_AUTH_PORT"]:
        raise ValueError("HTTP ポートと認証ポートは異なる値を指定してください")
    if not re.fullmatch(r"[0-9]+(?:\.[0-9]+)?", cfg["LOAD_API_CPUS"]) or not 0.1 <= float(cfg["LOAD_API_CPUS"]) <= 128:
        raise ValueError("LOAD_API_CPUS は 0.1〜128 の数値にしてください")
    if int(cfg["LOAD_API_REPLICAS"]) * int(cfg["LOAD_DB_CONNECTIONS"]) > 90:
        raise ValueError("API の接続プール合計を90以下にしてください")
    if cfg["LOAD_MOCK_MODE"] not in MODES:
        raise ValueError("LOAD_MOCK_MODE が未対応です")
    for key in ("LOAD_DB_PASSWORD", "LOAD_USER_PASSWORD"):
        if not re.fullmatch("[0-9a-f]{64}", cfg[key]):
            raise ValueError(f"{key} は init で生成した値が必要です")
    if (cfg["LOAD_UID"], cfg["LOAD_GID"]) != (str(os.getuid()), str(os.getgid())) or not os.getuid():
        raise ValueError("init を実行した一般ユーザーで実行してください")
    for name in ("client", "server"):
        path = KEYS / name
        private(path, 0o700)
        for filename in ("ca.crt", "token", f"{name}.crt", f"{name}.key"):
            private(path / filename, 0o600)
        openssl("x509", "-checkend", "0", "-noout", "-in", path / f"{name}.crt")
        args = ["-verify_hostname", "mock-tapyrus"] if name == "server" else []
        openssl("verify", "-purpose", f"ssl{name}", *args, "-CAfile", path / "ca.crt", path / f"{name}.crt")
        if openssl("x509", "-in", path / f"{name}.crt", "-noout", "-pubkey") != openssl(
                "pkey", "-in", path / f"{name}.key", "-pubout"):
            raise ValueError("試験証明書と鍵が一致しません。load/credentials を退避して init を再実行してください")
    token = (KEYS / "server/token").read_bytes()
    if not re.fullmatch(b"[0-9a-f]{64}\\n", token) or token != (KEYS / "client/token").read_bytes():
        raise ValueError("模擬 API とクライアントのトークンが一致しません")
    for path in (KEYS, STATE, STATE / "mock", RESULTS):
        private(path, 0o700)
    return cfg


def compose(*args, **kwargs):
    return run(COMPOSE + list(args), **kwargs)


def preflight(cfg, *, check_ports=True):
    raw = compose("--profile", "tools", "config", "--format", "json", capture=True).stdout
    config = json.loads(raw)
    if config["name"] != PROJECT or not config["networks"]["default"].get("internal"):
        raise ValueError("Compose のプロジェクトまたは分離ネットワークが不正です")
    resources = {"networks": {"default", "edge"}, "volumes": {"load-db", "load-firebase"}}
    for group, expected in resources.items():
        if set(config[group]) != expected:
            raise ValueError(f"専用 Compose の {group} が設定と一致しません")
        for key, item in config[group].items():
            if item.get("external") or item["name"] != f"{PROJECT}_{key}":
                raise ValueError(f"専用プロジェクト外の {group} は使用できません")
    safe_mounts = {"load/nginx.conf", "load/scenario.js", "load/config", "backend/db", "backend/db/migrations",
                   "load/credentials/client", "load/credentials/server", "load/state", "load/state/mock", "load/results"}
    for name, service in config["services"].items():
        if service.get("privileged") or service.get("network_mode") or service.get("env_file"):
            raise ValueError(f"分離できないサービス設定: {name}")
        if any(port.get("host_ip") != "127.0.0.1" or name != "nginx" for port in service.get("ports", [])):
            raise ValueError(f"許可されていないポート公開: {name}")
        if "edge" in service.get("networks", {}) and name != "nginx":
            raise ValueError(f"専用内部ネットワークから外れるサービス: {name}")
        for mount in service.get("volumes", []):
            if mount["type"] == "bind":
                path = Path(mount["source"])
                if not path.is_relative_to(ROOT) or path.relative_to(ROOT).as_posix() not in safe_mounts:
                    raise ValueError(f"許可されていないマウント: {name}")
                safe(path)
                if not path.exists():
                    raise ValueError(f"マウント元がありません: {path.relative_to(ROOT)}")
    backend = config["services"]["backend"]["environment"]
    if (backend["TAPYRUS_API_URL"], backend["FIREBASE_AUTH_EMULATOR_HOST"], backend["FIREBASE_PROJECT_ID"],
        backend["DB_HOST"], backend["POSTGRES_DB"]) != (
            "https://mock-tapyrus:8443", "firebase-auth:9099", "demo-mobile-tracer-load", "db", "mobile_tracer_load"):
        raise ValueError("API の接続先が負荷試験の専用構成と一致しません")
    if not check_ports:
        return
    for key, internal in (("LOAD_HTTP_PORT", "8080"), ("LOAD_AUTH_PORT", "9099")):
        port = int(cfg[key])
        bound = compose("port", "nginx", internal, capture=True, check=False, quiet=True)
        if bound.returncode == 0 and bound.stdout.strip() == f"127.0.0.1:{port}":
            continue
        with socket.socket() as probe:
            try:
                probe.bind(("127.0.0.1", port))
            except OSError:
                raise ValueError(f"127.0.0.1:{port} が使用中です。.env.load の {key} を変更してください") from None


def tools(*args, **kwargs):
    return compose("run", "--rm", "--no-deps", "tools", "python3", "/work/data.py", *args, **kwargs)


def up(cfg, replicas=None):
    preflight(cfg)
    count = replicas or int(cfg["LOAD_API_REPLICAS"])
    if count * int(cfg["LOAD_DB_CONNECTIONS"]) > 90:
        raise ValueError("API の接続プール合計を90以下にしてください")
    if replicas is None:
        compose("up", "--build", "-d", "--wait", "--wait-timeout", "180", "--scale", f"backend={count}")
        compose("exec", "-T", "nginx", "nginx", "-s", "reload")
    else:
        compose("up", "--no-build", "--no-deps", "--no-recreate", "-d", "--wait", "--wait-timeout", "60",
                "--scale", f"backend={count}", "backend")
        # Allow the dedicated DNS cache to refresh after replica membership changes.
        time.sleep(3)
    tools("probe")


def snapshot(*, cpu_detail=False):
    db = json.loads(tools("stats", capture=True).stdout)
    ids = compose("ps", "-q", capture=True).stdout.split()
    ids += run(DOCKER + ["ps", "-q", "--filter", f"label=com.docker.compose.project={PROJECT}",
                         "--filter", "label=com.docker.compose.service=k6"], capture=True).stdout.split()
    if not ids:
        return {"db": db, "docker": [], "limits": []}
    ids = list(dict.fromkeys(ids))
    stats = run(DOCKER + ["stats", "--no-stream", "--format", "{{json .}}", *ids], capture=True, check=False, quiet=True)
    inspect = run(DOCKER + ["inspect", "--format",
                   '{{json .Name}} {{json .RestartCount}} {{json .HostConfig.NanoCpus}} {{json .HostConfig.Memory}}',
                   *ids], capture=True, check=False, quiet=True)
    limits = []
    for line in inspect.stdout.splitlines():
        name, restarts, cpus, memory = line.split()
        limits.append({"name": json.loads(name), "restarts": int(restarts), "nano_cpus": int(cpus), "memory_bytes": int(memory)})
    cpu = {}
    if cpu_detail:
        for ident in ids:
            sample = run(DOCKER + ["exec", ident, "cat", "/sys/fs/cgroup/cpu.stat"],
                         capture=True, check=False, quiet=True)
            if sample.returncode == 0:
                cpu[ident] = {key: int(value) for key, value in (line.split() for line in sample.stdout.splitlines())}
    host = {}
    for file in ("stat", "meminfo", "diskstats"):
        path = Path("/proc") / file
        if path.is_file():
            lines = path.read_text().splitlines()
            host[file] = lines[:1] if file == "stat" else lines
    return {"db": db, "docker": [json.loads(line) for line in stats.stdout.splitlines()],
            "limits": limits, "cpu_stat_by_id": cpu, "host": host}


def trial(cfg, args, *, warmup=False):
    duration = args.warmup if warmup else args.duration
    scenario = "read" if warmup else args.scenario
    ident = ("warmup-" if warmup else "") + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ-") + uuid.uuid4().hex[:8]
    output = RESULTS / ident
    output.mkdir(mode=0o700)
    dataset = json.loads((STATE / "dataset.json").read_text())
    verified = STATE / "verification.json"
    if verified.is_file():
        proof = json.loads(verified.read_text())
        if proof["dataset_digest"] == dataset["digest"]:
            dataset["initial_fingerprint"] = proof["fingerprint"]
    tools("prepare", "read" if scenario == "mixed" and args.read_percent == 100 else scenario)
    since = datetime.now(timezone.utc).isoformat()
    before = snapshot(cpu_detail=True)
    replicas = len(compose("ps", "-q", "backend", capture=True).stdout.split())
    settings = dict(id=ident, started_at=since, sha=run(["git", "rev-parse", "HEAD"], capture=True).stdout.strip(),
                    dirty=bool(run(["git", "status", "--porcelain"], capture=True).stdout.strip()), dataset=dataset,
                    scenario=scenario, duration_seconds=duration, warmup_seconds=args.warmup,
                    vus=1 if args.once and not warmup else args.vus, arrival_rate=args.rate or None,
                    single_iteration=args.once and not warmup, read_percent=args.read_percent,
                    image_bytes=args.image_bytes, api_instances=replicas, mock=cfg["LOAD_MOCK_MODE"],
                    mock_delay_ms=int(cfg["LOAD_MOCK_DELAY_MS"]), mock_confirm_seconds=int(cfg["LOAD_CONFIRM_SECONDS"]),
                    host={"cpus": os.cpu_count(), "memory_bytes": os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES"),
                          "free_workspace_bytes": shutil.disk_usage(ROOT).free})
    env = {"SCENARIO": scenario, "VUS": args.vus, "SECONDS": duration, "RATE": args.rate,
           "READ_PERCENT": args.read_percent, "RESULT": ident, "ONCE": int(args.once and not warmup)}
    extra = [value for key, val in env.items() for value in ("-e", f"{key}={val}")]
    if args.image_bytes and scenario in {"images", "mixed"}:
        tools("image", str(args.image_bytes))
    cmd = COMPOSE + ["run", "--rm", "--no-deps", *extra, "k6", "run", "--quiet", "/scenario.js"]
    samples = []
    process = subprocess.Popen(cmd, env=PROCESS_ENV)
    try:
        while process.poll() is None:
            if len(samples) == 0 or time.monotonic() - last >= 5:
                last = time.monotonic()
                samples.append(snapshot())
            time.sleep(0.5)
    finally:
        if process.poll() is None:
            process.terminate()
            process.wait()
    after = snapshot(cpu_detail=True)
    logs = compose("logs", "--since", since, "--no-log-prefix", "nginx", capture=True).stdout
    upstream = {}
    for line in logs.splitlines():
        match = re.fullmatch(r"\S+ \d{3} ([0-9.]+:8080) [0-9.]+ business", line.strip())
        if match:
            ip = match[1]
            upstream[ip] = upstream.get(ip, 0) + 1
    settings.update(before=before, after=after, samples=samples, upstream_requests=upstream,
                    k6_exit_code=process.returncode)
    (output / "report.json").write_text(json.dumps(settings, ensure_ascii=False, indent=2) + "\n")
    print(f"結果 {output.relative_to(ROOT)}")
    if process.returncode:
        raise ValueError(f"k6 が終了コード {process.returncode} を返しました")
    return settings


def failover(cfg):
    replicas = compose("ps", "-q", "backend", capture=True).stdout.split()
    if len(replicas) != 2:
        raise ValueError("failover の前に compare または up で API を2台起動してください")
    removed = replicas[-1]
    run(DOCKER + ["stop", removed])
    try:
        time.sleep(3)
        args = argparse.Namespace(scenario="read", duration=5, warmup=0, vus=2, rate=2,
                                  read_percent=70, image_bytes=0, once=False)
        result = trial(cfg, args)
        if result["api_instances"] != 1 or len(result["upstream_requests"]) != 1:
            raise ValueError("API 停止後に残った1台への転送を確認できません")
    finally:
        up(cfg, 2)


def report():
    import csv
    writer = csv.writer(sys.stdout)
    writer.writerow(["run", "scenario", "api", "vus", "rate", "exit", "starts_per_second", "dropped_iterations",
                     "p50_ms", "p95_ms", "p99_ms", "http_failed", "business_failed"])
    for path in sorted(RESULTS.glob("*/report.json")):
        meta = json.loads(path.read_text())
        result = path.with_name("k6.json")
        metrics = json.loads(result.read_text())["metrics"] if result.exists() else {}
        latency = metrics.get("http_req_duration{phase:business}", {}).get("values", {})
        starts = metrics.get("iteration_started", {}).get("values", {}).get("count")
        measured = bool(latency.get("count"))
        writer.writerow([meta["id"], meta["scenario"], meta["api_instances"], meta["vus"], meta["arrival_rate"],
                         meta["k6_exit_code"], starts / meta["duration_seconds"] if starts is not None else None,
                         metrics.get("dropped_iterations", {}).get("values", {}).get("count"),
                         latency.get("med") if measured else None, latency.get("p(95)") if measured else None,
                         latency.get("p(99)") if measured else None,
                         metrics.get("http_req_failed{phase:business}", {}).get("values", {}).get("rate") if measured else None,
                         metrics.get("business_failed", {}).get("values", {}).get("rate") if measured else None])


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("init", "check", "up", "down", "verify", "smoke", "stats", "tests", "report",
                 "clean", "reset", "registration", "failover"):
        sub.add_parser(name)
    for name in ("estimate", "seed"):
        sub.add_parser(name).add_argument("size", choices=("small", "medium", "large", "probe"))
    for name in ("run", "compare"):
        cmd = sub.add_parser(name)
        if name == "run":
            cmd.add_argument("scenario", choices=("read", "write", "images", "registration", "mixed", "login", "conflict"))
            cmd.add_argument("--once", action="store_true")
        else:
            cmd.set_defaults(scenario="read", once=False)
        cmd.add_argument("--duration", type=int, default=10)
        cmd.add_argument("--warmup", type=int, default=0)
        cmd.add_argument("--vus", type=int, default=2)
        cmd.add_argument("--rate", type=int, default=0)
        cmd.add_argument("--read-percent", type=int, default=70)
        cmd.add_argument("--image-bytes", type=int, default=0)
    args = parser.parse_args()
    cmd = args.command
    if cmd == "init":
        return init()
    if cmd == "report":
        private(RESULTS, 0o700)
        return report()
    cfg = validate()
    lock = ENV.open()
    fcntl.flock(lock, fcntl.LOCK_EX)
    if cmd not in ("check", "up", "estimate"):
        preflight(cfg, check_ports=False)
    if cmd == "check":
        preflight(cfg)
        print("専用 Compose 設定・ポート・マウント・証明書を確認しました")
    elif cmd == "up":
        up(cfg)
    elif cmd == "down":
        compose("down")
    elif cmd in ("clean", "reset"):
        paths = (STATE, RESULTS) if cmd == "clean" else (STATE,)
        print(f"削除対象 {PROJECT} のコンテナ・専用ボリューム・ネットワーク、"
              + "、".join(str(path.relative_to(ROOT)) for path in paths))
        if input(f"続けるには {PROJECT} と入力してください: ") != PROJECT:
            raise ValueError("削除を中止しました")
        compose("down", "--volumes")
        for path in paths:
            safe(path)
            shutil.rmtree(path)
            private_dir(path)
        private_dir(STATE / "mock")
    elif cmd == "estimate":
        preflight(cfg)
        compose("build", "tools", capture=True)
        tools("estimate", args.size)
    elif cmd == "seed":
        tools("seed", args.size)
    elif cmd in ("verify", "stats"):
        tools(cmd)
    elif cmd == "registration":
        tools(cmd, cfg["LOAD_MOCK_MODE"])
    elif cmd == "failover":
        failover(cfg)
    elif cmd == "tests":
        results = [compose("run", "--rm", "--no-deps", *args, check=False).returncode
                   for args in (("--build", "go-test"), ("db-test",),
                                ("--build", "tools", "python3", "-m", "unittest", "-q", "test_data"))]
        if any(results):
            raise ValueError(f"テストが失敗しました。Go={results[0]}, DB={results[1]}, 生成={results[2]}")
    else:
        if cmd == "smoke":
            tools("probe")
            args = argparse.Namespace(scenario="read", duration=5, warmup=0, vus=2, rate=2,
                                      read_percent=70, image_bytes=0, once=False)
        if args.scenario == "conflict":
            args.once = True
        if args.once and args.rate:
            raise ValueError("--once と --rate は同時に指定できません")
        if not (1 <= args.duration <= 86400 and 0 <= args.warmup <= 3600 and 1 <= args.vus <= 1000
                and 0 <= args.rate <= 100000 and 0 <= args.read_percent <= 100 and 0 <= args.image_bytes <= 10485760):
            raise ValueError("試験条件が範囲外です")
        for count in ((1, 2) if cmd == "compare" else (None,)):
            if count:
                up(cfg, count)
            if args.warmup:
                trial(cfg, args, warmup=True)
            result = trial(cfg, args)
            if count == 2 and len(result["upstream_requests"]) < 2:
                raise ValueError("2台の API に振り分けた記録がありません")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        sys.exit(str(error) if not isinstance(error, subprocess.CalledProcessError) else
                 f"コマンドが失敗しました（終了コード {error.returncode}）")
