"""Shared helpers for the local Compose smoke checks (Python standard library only)."""

import json
from pathlib import Path
import subprocess
import time
import urllib.request

ROOT = Path(__file__).resolve().parent.parent


def compose(*args, input=None):
    result = subprocess.run(
        ["docker", "compose", *args], cwd=ROOT, input=input,
        text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120,
    )
    if result.returncode:
        # Arguments and output never include RPC passwords or signing keys.
        raise RuntimeError(result.stderr.strip() or "Compose command failed")
    return result.stdout.strip()


def rpc(method, *params):
    values = [p if isinstance(p, str) else json.dumps(p) for p in params]
    output = compose(
        "exec", "-T", "tapyrusd", "sh", "/opt/tapyrus/rpc.sh", method,
        input="".join(value + "\n" for value in values),
    )
    try:
        return json.loads(output)
    except json.JSONDecodeError:
        # tapyrus-cli prints string results (addresses/txids) without quotes.
        return output


def backend_url():
    address = compose("port", "backend", "8080")
    return "http://" + address


def get_json(path):
    with urllib.request.urlopen(backend_url() + path, timeout=10) as response:
        if response.status != 200:
            raise RuntimeError(f"{path} returned HTTP {response.status}")
        return json.load(response)


def check_chain():
    return json.loads(compose("exec", "-T", "backend", "/app/tapyrus-check"))


def wait_for_index(timeout=60):
    deadline = time.monotonic() + timeout
    while True:
        try:
            return check_chain()
        except RuntimeError:
            if time.monotonic() >= deadline:
                raise
            time.sleep(1)
