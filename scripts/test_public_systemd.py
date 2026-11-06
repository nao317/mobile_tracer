#!/usr/bin/env python3
"""Exercise the real unit's restart policy with transient dummy services, never Docker."""
import argparse
import configparser
from pathlib import Path
import subprocess
import tempfile
import time
import uuid

ROOT = Path(__file__).resolve().parent.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--system", action="store_true", help="Use the system manager (requires root); default: user manager")
    args = parser.parse_args()
    scope = [] if args.system else ["--user"]
    cfg = configparser.ConfigParser(interpolation=None)
    cfg.read(ROOT / "docker/systemd/mobile-tracer-public.service")
    for phase in ("pre", "start"):
        unit = "mobile-tracer-retry-test-" + uuid.uuid4().hex
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp)
            stub = path / "dummy.sh"
            stub.write_text('''#!/bin/bash
set -eu
cd -- "$(dirname -- "$0")"
count=0
if [ -f "$1.count" ]; then read -r count < "$1.count"; fi
count=$((count+1))
echo "$count" > "$1.count"
if [ "$1" = "$2" ] && [ "$count" -eq 1 ]; then exit 1; fi
''')
            command = ["systemd-run", *scope, "--unit", unit, "--no-block"]
            for section, key in (("Unit", "StartLimitIntervalSec"), ("Service", "Type"),
                                 ("Service", "RemainAfterExit"), ("Service", "Restart"), ("Service", "RestartSec")):
                command += ["--property", key + "=" + cfg[section][key]]
            command += ["--property", f"ExecStartPre=/bin/bash {stub} pre {phase}",
                        "/bin/bash", str(stub), "start", phase]
            try:
                subprocess.run(command, check=True, capture_output=True, text=True)
                deadline = time.monotonic() + 50
                while time.monotonic() < deadline:
                    output = subprocess.check_output(["systemctl", *scope, "show", unit,
                                                      "--property=ActiveState,SubState,NRestarts"], text=True)
                    state = dict(line.split("=", 1) for line in output.splitlines())
                    if state.get("ActiveState") == "active" and state.get("SubState") == "exited":
                        assert int(state["NRestarts"]) >= 1, "Expected a restart after the injected failure"
                        assert (path / "pre.count").read_text().strip() == "2"
                        assert (path / "start.count").read_text().strip() == ("1" if phase == "pre" else "2")
                        print(f"{phase} failure: retried with RestartSec={cfg['Service']['RestartSec']}, then active/exited", flush=True)
                        break
                    time.sleep(0.2)
                else:
                    raise RuntimeError(f"{phase}: unit did not recover after an injected startup failure")
            finally:
                subprocess.run(["systemctl", *scope, "stop", unit], capture_output=True)
                subprocess.run(["systemctl", *scope, "reset-failed", unit], capture_output=True)


if __name__ == "__main__":
    main()
