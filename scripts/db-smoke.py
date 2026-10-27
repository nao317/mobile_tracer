#!/usr/bin/env python3
"""Check API startup rejection, DB outage detection and recovery on local Compose."""

import json
import subprocess
import time
import urllib.error
import urllib.request
import uuid

from tapyrus_common import ROOT, application_url, compose


def expect_status(base, path, expected):
    try:
        response = urllib.request.urlopen(base + path, timeout=10)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        status = response.status
        body = json.load(response)
    wanted = {"status": "ok" if expected == 200 else "unavailable"}
    if status != expected or body != wanted:
        raise RuntimeError(f"Unexpected response from {path}: HTTP {status}")


def main():
    base = application_url()
    expect_status(base, "/api/ready", 200)
    # A separate API process must fail before listening if authentication fails.
    password = "invalid-smoke-" + uuid.uuid4().hex
    result = subprocess.run(
        ["docker", "compose", "run", "--rm", "--no-deps", "-e",
         "POSTGRES_PASSWORD=" + password, "backend"],
        cwd=ROOT, capture_output=True, text=True, timeout=20,
    )
    output = result.stdout + result.stderr
    if (result.returncode != 1 or "PostgreSQL connection check failed" not in output
            or "API server started" in output or password in output):
        raise RuntimeError("API did not safely reject invalid database credentials")
    print("API rejects invalid database credentials before listening.", flush=True)

    try:
        compose("stop", "db")
        expect_status(base, "/api/health", 200)
        expect_status(base, "/api/ready", 503)
        print("DB stopped: health=200, ready=503.", flush=True)
    finally:
        compose("start", "db")

    deadline = time.monotonic() + 60
    while True:
        try:
            expect_status(base, "/api/ready", 200)
            break
        except (RuntimeError, urllib.error.URLError):
            if time.monotonic() >= deadline:
                raise RuntimeError("API did not recover after PostgreSQL restarted") from None
            time.sleep(1)
    print("DB restarted: API readiness recovered without restarting the API.")


if __name__ == "__main__":
    main()
