#!/usr/bin/env python3
"""Run the documented restore against a fresh isolated PostgreSQL volume."""
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import tempfile
import uuid

ROOT = Path(__file__).resolve().parent.parent


def main():
    blocks = re.findall(r"```bash\n(.*?)\n```", (ROOT / "docs/hosting.md").read_text(), re.S)
    restore = next(block for block in blocks if "RESTORE_TIMESTAMP" in block)
    start = next(line for line in restore.splitlines() if line.startswith("bash scripts/public.sh up") and line.endswith(" db"))
    restore_line = next(line for line in restore.splitlines() if "exec -T db" in line and "pg_restore" in line)
    restore_args = shlex.split(restore_line)
    restore_args = restore_args[:restore_args.index("<")]
    with tempfile.TemporaryDirectory() as temp:
        folder = Path(temp)
        envfile = folder / "test.env"
        envfile.write_text("POSTGRES_PASSWORD=test-only-password\nTAPYRUS_RPC_PASSWORD=test-only-rpc\n")
        envfile.chmod(0o600)
        # Shell exports take precedence over --env-file; never borrow deployment passwords.
        env = {**os.environ, "POSTGRES_DB": "restore_test", "POSTGRES_USER": "restore_test",
               "POSTGRES_PASSWORD": "test-only-password", "TAPYRUS_RPC_PASSWORD": "test-only-rpc"}
        resolved = json.loads(subprocess.check_output(
            ["docker", "compose", "--env-file", str(envfile), "-f", str(ROOT / "compose.yaml"),
             "config", "--format", "json"], env=env))
        init = folder / "slow.sql"
        init.write_text("SELECT pg_sleep(5);\nCREATE TABLE restore_wait_probe(value text);\nINSERT INTO restore_wait_probe VALUES ('ready');\n")
        init.chmod(0o644)
        db = resolved["services"]["db"]
        db["volumes"].append({"type": "bind", "source": str(init),
                              "target": "/docker-entrypoint-initdb.d/slow.sql", "read_only": True})
        # Never reuse resolved volume names from an application deployment.
        config = {"services": {"db": db}, "volumes": {"db-data": {}}}
        path = folder / "compose.json"
        path.write_text(json.dumps(config))
        command = ["docker", "compose", "-p", "mobile-tracer-restore-test-" + uuid.uuid4().hex[:8], "-f", str(path)]
        try:
            subprocess.run(command + shlex.split(start)[2:], check=True)
            dump = subprocess.check_output(command + ["exec", "-T", "db", "sh", "-c",
                'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -t restore_wait_probe'])
            subprocess.run(command + ["exec", "-T", "db", "sh", "-c",
                'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c "DROP TABLE restore_wait_probe"'], check=True)
            subprocess.run(command + restore_args[2:], input=dump, check=True)
            value = subprocess.check_output(command + ["exec", "-T", "db", "sh", "-c",
                'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT value FROM restore_wait_probe"'], text=True)
            assert value.strip() == "ready", "Restored data was not found"
            print("Fresh PostgreSQL initialization, readiness wait and documented pg_restore: OK", flush=True)
        finally:
            subprocess.run(command + ["down", "--volumes", "--timeout", "5"], check=True)


if __name__ == "__main__":
    main()
