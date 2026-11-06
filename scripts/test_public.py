#!/usr/bin/env python3
"""Exercise the public deployment's fail-closed configuration policy."""
from copy import deepcopy
import json
import os
from pathlib import Path
import runpy
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
checker = runpy.run_path(str(ROOT / "scripts/public-check.py"))
validate = checker["validate"]
validate_env_file = checker["validate_env_file"]


class PublicConfigTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # A real Compose merge, with only non-secret test values. No daemon needed.
        env = {key: value for key, value in os.environ.items()
               if not key.startswith(("FIREBASE_", "AUTH_", "COMPOSE_", "DEV_AUTH_", "PUBLIC_", "POSTGRES_", "TAPYRUS_"))}
        with tempfile.TemporaryDirectory() as temp:
            envfile = Path(temp) / "test.env"
            envfile.write_text((ROOT / ".env.public.example").read_text().replace(
                "FIREBASE_API_KEY=", "FIREBASE_API_KEY=test-web-api-key").replace(
                "POSTGRES_PASSWORD=", "POSTGRES_PASSWORD=test-db-password").replace(
                "TAPYRUS_RPC_PASSWORD=", "TAPYRUS_RPC_PASSWORD=test-rpc-password").replace(
                "FIREBASE_CREDENTIALS_FILE=", f"FIREBASE_CREDENTIALS_FILE={temp}/admin.json").replace(
                "CLOUDFLARE_TUNNEL_TOKEN_FILE=", f"CLOUDFLARE_TUNNEL_TOKEN_FILE={temp}/token"))
            command = ["docker", "compose", "--project-name", "mobile-tracer-public", "--env-file", str(envfile)]
            for name in ("compose.yaml", "compose.firebase.yaml", "compose.public.yaml"):
                command += ["-f", str(ROOT / name)]
            cls.config = json.loads(subprocess.check_output(command + ["config", "--format", "json"], env=env))

    def test_real_compose_merge(self):
        validate(self.config, check_files=False)
        self.assertEqual(self.config["services"]["backend"]["environment"]["APP_ENV"], "production")

    def test_rejects_unsafe_configuration(self):
        for key, value in (("AUTH_PUBLIC_URL", "http://mbtracer.yellowtail.work"),
                           ("AUTH_PUBLIC_URL", "https://localhost"),
                           ("AUTH_PUBLIC_URL", "https://mbtracer.yellowtail.work/"),
                           ("APP_ENV", "development"),
                           ("FIREBASE_PROJECT_ID", "demo-mobile-tracer"),
                           ("FIREBASE_API_KEY", ""),
                           ("FIREBASE_AUTH_EMULATOR_HOST", "firebase-auth:9099"),
                           ("FIREBASE_AUTH_EMULATOR_URL", "http://localhost:9099"),
                           ("DEV_AUTH_TOKEN", "test"), ("DEV_AUTH_STAFF_ID", "test")):
            with self.subTest(key=key, value=value):
                config = deepcopy(self.config)
                config["services"]["backend"]["environment"][key] = value
                with self.assertRaises(ValueError):
                    validate(config, check_files=False)

    def test_rejects_any_host_port(self):
        for service in ("nginx", "frontend", "backend", "db", "tapyrusd", "esplora", "cloudflared"):
            with self.subTest(service=service):
                config = deepcopy(self.config)
                config["services"][service]["ports"] = [{"target": 8080, "published": "8080"}]
                with self.assertRaises(ValueError):
                    validate(config, check_files=False)

    def test_rejects_tunnel_network_bypass(self):
        config = deepcopy(self.config)
        config["services"]["cloudflared"]["networks"]["default"] = None
        with self.assertRaises(ValueError):
            validate(config, check_files=False)

    def test_rejects_missing_secrets(self):
        with self.assertRaises(ValueError):
            validate(self.config)

    def test_rejects_broad_proxy_trust(self):
        config = deepcopy(self.config)
        config["services"]["backend"]["environment"]["TRUSTED_PROXY_CIDRS"] = "0.0.0.0/0"
        with self.assertRaises(ValueError):
            validate(config, check_files=False)

    def test_rejects_proxy_ip_allocation_conflicts(self):
        for dynamic_range in ("172.30.72.0/24", "172.30.73.128/25"):
            with self.subTest(dynamic_range=dynamic_range):
                config = deepcopy(self.config)
                config["networks"]["default"]["ipam"]["config"][0]["ip_range"] = dynamic_range
                with self.assertRaises(ValueError):
                    validate(config, check_files=False)

    def test_secret_permissions_and_project(self):
        with tempfile.TemporaryDirectory() as temp:
            config = deepcopy(self.config)
            files = {}
            for service, target in (("backend", "/run/secrets/firebase-admin.json"),
                                    ("cloudflared", "/run/secrets/tunnel-token")):
                path = Path(temp) / service
                path.write_text("test-token")
                path.chmod(0o600)
                mount = next(v for v in config["services"][service]["volumes"] if v["target"] == target)
                mount["source"] = str(path)
                config["services"][service]["user"] = f"{os.getuid()}:{os.getgid()}"
                files[service] = path
            credentials = {"type": "service_account", "project_id": "mobile-tracer-2d1e3",
                           "private_key": "test-not-a-real-private-key", "client_email": "test@example.com"}
            files["backend"].write_text(json.dumps(credentials))
            validate(config)
            # Internal preparation can run before a Tunnel exists; public startup cannot.
            files["cloudflared"].unlink()
            validate(config, include_tunnel=False)
            with self.assertRaises(ValueError):
                validate(config)
            files["cloudflared"].write_text("test-token")
            files["cloudflared"].chmod(0o600)
            files["cloudflared"].chmod(0o644)
            with self.assertRaises(ValueError):
                validate(config)
            files["cloudflared"].chmod(0o600)
            credentials["project_id"] = "another-project"
            files["backend"].write_text(json.dumps(credentials))
            with self.assertRaises(ValueError):
                validate(config)

    def test_repository_secrets_must_be_ignored_and_untracked(self):
        from unittest.mock import patch
        secret_dir = ROOT / "secrets"
        created = not secret_dir.exists()
        secret_dir.mkdir(exist_ok=True)
        try:
            with tempfile.TemporaryDirectory(dir=secret_dir) as temp:
                config = deepcopy(self.config)
                for service, target in (("backend", "/run/secrets/firebase-admin.json"),
                                        ("cloudflared", "/run/secrets/tunnel-token")):
                    path = Path(temp) / service
                    path.write_text(json.dumps({"type": "service_account", "project_id": "mobile-tracer-2d1e3",
                                                "private_key": "test-key", "client_email": "test@example.com"})
                                    if service == "backend" else "test-token")
                    path.chmod(0o600)
                    mount = next(v for v in config["services"][service]["volumes"] if v["target"] == target)
                    mount["source"] = str(path)
                    config["services"][service]["user"] = f"{os.getuid()}:{os.getgid()}"
                validate(config)
                with patch.object(subprocess, "run") as run:
                    run.return_value.returncode = 0  # Tracked even if .gitignore matches.
                    with self.assertRaisesRegex(ValueError, "untracked and ignored"):
                        validate(config)
                with patch.object(subprocess, "run") as run:
                    run.return_value.returncode = 1  # Untracked but not ignored.
                    with self.assertRaisesRegex(ValueError, "untracked and ignored"):
                        validate(config)
            with tempfile.NamedTemporaryFile(dir=ROOT) as outside:
                config = deepcopy(self.config)
                mount = next(v for v in config["services"]["backend"]["volumes"]
                             if v["target"] == "/run/secrets/firebase-admin.json")
                mount["source"] = outside.name
                outside.write(b"test")
                outside.flush()
                with self.assertRaisesRegex(ValueError, "under ignored secrets"):
                    validate(config)
        finally:
            if created:
                secret_dir.rmdir()


class PublicWrapperTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.envfile = self.folder / "public.env"
        self.token = self.folder / "token"
        self.token.write_text("test-token")
        self.token.chmod(0o600)
        self.admin = self.folder / "admin.json"
        self.admin.write_text(json.dumps({"type": "service_account", "project_id": "mobile-tracer-2d1e3",
                                         "private_key": "test-key", "client_email": "test@example.com"}))
        self.admin.chmod(0o600)
        self.env = {key: value for key, value in os.environ.items()
                    if not key.startswith(("PUBLIC_", "FIREBASE_", "AUTH_", "DEV_AUTH_", "COMPOSE_", "POSTGRES_", "TAPYRUS_"))}
        values = {"FIREBASE_API_KEY": "test-web-key", "POSTGRES_PASSWORD": "private-test-marker",
                  "TAPYRUS_RPC_PASSWORD": "test-rpc-password", "PUBLIC_UID": str(os.getuid()),
                  "PUBLIC_GID": str(os.getgid()), "FIREBASE_CREDENTIALS_FILE": str(self.admin),
                  "CLOUDFLARE_TUNNEL_TOKEN_FILE": str(self.token)}
        self.envtext = "\n".join(
            line.split("=", 1)[0] + "=" + values[line.split("=", 1)[0]]
            if line.split("=", 1)[0] in values else line
            for line in (ROOT / ".env.public.example").read_text().splitlines()) + "\n"
        self.envfile.write_text(self.envtext)
        self.envfile.chmod(0o600)
        self.compose = ["docker", "compose", "--project-name", "mobile-tracer-public", "--env-file", str(self.envfile)]
        for name in ("compose.yaml", "compose.firebase.yaml", "compose.public.yaml"):
            self.compose += ["-f", str(ROOT / name)]
        self.configfile = self.folder / "resolved.json"
        self.resolve_config()
        self.calls = self.folder / "calls.jsonl"
        fakebin = self.folder / "bin"
        fakebin.mkdir()
        docker = fakebin / "docker"
        docker.write_text("""#!/usr/bin/env python3
import json, os, pathlib, sys
args = sys.argv[1:]
with open(os.environ['TEST_COMPOSE_CALLS'], 'a') as out:
    out.write(json.dumps(args) + '\\n')
if 'config' in args:
    print(pathlib.Path(os.environ['TEST_COMPOSE_CONFIG']).read_text())
elif 'up' in args and args[-1] == 'db' and '--wait' in args and os.environ.get('TEST_DB_NOT_READY') == '1':
    sys.exit(70)
""")
        docker.chmod(0o700)
        self.fake_env = {**self.env, "PATH": str(fakebin) + os.pathsep + self.env["PATH"],
                         "PUBLIC_ENV_FILE": str(self.envfile), "TEST_COMPOSE_CONFIG": str(self.configfile),
                         "TEST_COMPOSE_CALLS": str(self.calls)}

    def resolve_config(self):
        output = subprocess.check_output(self.compose + ["config", "--format", "json"], env=self.env)
        self.configfile.write_bytes(output)
        return json.loads(output)

    def run_wrapper(self, *args):
        return subprocess.run(["bash", str(ROOT / "scripts/public.sh"), *args],
                              env=self.fake_env, text=True, capture_output=True, cwd=self.folder)

    def commands(self):
        return [json.loads(line) for line in self.calls.read_text().splitlines()] if self.calls.exists() else []

    def test_env_metadata(self):
        validate_env_file(self.envfile)
        for mode in (0o644, 0o640, 0o660, 0o666):
            with self.subTest(mode=oct(mode)):
                self.envfile.chmod(mode)
                with self.assertRaises(ValueError):
                    validate_env_file(self.envfile)
        self.envfile.chmod(0o600)
        with self.assertRaises(ValueError):
            validate_env_file(self.envfile, owner_uid=os.getuid() + 1)
        with self.assertRaises(ValueError):
            validate_env_file(self.folder / "absent.env")
        with self.assertRaises(ValueError):
            validate_env_file(self.folder)

    def test_unsafe_env_never_reaches_compose(self):
        self.envfile.chmod(0o644)
        for args in (("check",), ("up", "-d"), ("build",), ("prepare",), ("config", "--quiet")):
            with self.subTest(args=args):
                result = self.run_wrapper(*args)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("mode 600", result.stderr)
                self.assertNotIn("private-test-marker", result.stdout + result.stderr)
                self.assertEqual(self.commands(), [])

    def test_secure_env_preserves_compose_machine_output(self):
        result = self.run_wrapper("config", "--format", "json")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), json.loads(self.configfile.read_text()))

    def test_blank_token_allows_preparation_but_blocks_public_start(self):
        self.envfile.write_text(self.envtext.replace(str(self.token), ""))
        config = self.resolve_config()  # Real Compose must interpolate successfully with an empty token path.
        validate(config, include_tunnel=False)
        for args in (("config", "--quiet"), ("build",), ("prepare",)):
            with self.subTest(args=args):
                result = self.run_wrapper(*args)
                self.assertEqual(result.returncode, 0, result.stderr)
        up = [args for args in self.commands() if "up" in args]
        self.assertEqual(len(up), 1)
        self.assertEqual(up[0][-1], "nginx")  # prepare must never launch the Tunnel.
        self.calls.unlink()
        for args in (("check",), ("up", "-d")):
            with self.subTest(args=args):
                result = self.run_wrapper(*args)
                self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any("up" in args for args in self.commands()))

    def test_documented_restore_stops_if_database_readiness_fails(self):
        import hashlib
        import re
        blocks = re.findall(r"```bash\n(.*?)\n```", (ROOT / "docs/hosting.md").read_text(), re.S)
        restore = next(block for block in blocks if "RESTORE_TIMESTAMP" in block)
        restore = restore.replace("backup_dir=/mnt/backup/mobile-tracer/RESTORE_TIMESTAMP",
                                  'backup_dir="$TEST_BACKUP_DIR"')
        backup = self.folder / "backup"
        backup.mkdir()
        names = ("database.dump", "tapyrus-data.tgz", "tapyrus-auth.tgz")
        for name in names:
            (backup / name).write_bytes(b"test-fixture")
        (backup / "SHA256SUMS").write_text("".join(
            hashlib.sha256((backup / name).read_bytes()).hexdigest() + "  " + name + "\n" for name in names))
        for unavailable in (True, False):
            with self.subTest(database_unavailable=unavailable):
                self.calls.unlink(missing_ok=True)
                env = {**self.fake_env, "TEST_BACKUP_DIR": str(backup), "TEST_DB_NOT_READY": "1" if unavailable else "0"}
                result = subprocess.run(["bash"], input=restore, text=True, env=env, cwd=ROOT, capture_output=True)
                commands = self.commands()
                restores = [args for args in commands if "exec" in args and any("pg_restore" in a for a in args)]
                if unavailable:
                    self.assertNotEqual(result.returncode, 0)
                    self.assertEqual(restores, [])
                else:
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertEqual(len(restores), 1)


if __name__ == "__main__":
    unittest.main()
