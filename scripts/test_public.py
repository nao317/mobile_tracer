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
validate = runpy.run_path(str(ROOT / "scripts/public-check.py"))["validate"]


class PublicConfigTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # A real Compose merge, with only non-secret test values. No daemon needed.
        env = {key: value for key, value in os.environ.items()
               if not key.startswith(("FIREBASE_", "AUTH_", "COMPOSE_", "DEV_AUTH_", "PUBLIC_"))}
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


if __name__ == "__main__":
    unittest.main()
