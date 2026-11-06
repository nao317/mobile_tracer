#!/usr/bin/env python3
"""Check resolved public Compose config without printing credentials."""
import argparse
import ipaddress
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
from urllib.parse import urlsplit


class ConfigurationError(ValueError):
    """An actionable message containing no configuration values or secret data."""


def validate_env_file(path, *, owner_uid=None):
    """Inspect metadata before Compose can read deployment credentials."""
    try:
        metadata = Path(path).stat()
    except OSError:
        raise ConfigurationError("Create the public environment file from .env.public.example") from None
    if owner_uid is None:
        # systemd runs as root, while the checkout belongs to its operator.
        owner_uid = Path(__file__).resolve().parent.parent.stat().st_uid
    if (not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != owner_uid
            or stat.S_IMODE(metadata.st_mode) != 0o600 or not os.access(path, os.R_OK)):
        raise ConfigurationError("Public environment file must be readable, owned by the checkout owner and mode 600")


def validate(config, *, check_files=True, include_tunnel=True):
    services = config["services"]
    backend = services["backend"]
    env = backend["environment"]
    origin = urlsplit(env.get("AUTH_PUBLIC_URL", ""))
    if (origin.scheme != "https" or not origin.hostname or origin.username
            or origin.password or origin.path or origin.query or origin.fragment
            or origin.hostname in ("localhost", "127.0.0.1", "::1")):
        raise ConfigurationError("AUTH_PUBLIC_URL must be a public HTTPS origin without a trailing slash")
    if env.get("APP_ENV") != "production":
        raise ConfigurationError("APP_ENV must be production")
    for key in ("FIREBASE_AUTH_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_URL", "DEV_AUTH_TOKEN", "DEV_AUTH_STAFF_ID"):
        if env.get(key):
            raise ConfigurationError(f"{key} must be empty")
    for key in ("FIREBASE_PROJECT_ID", "FIREBASE_API_KEY", "FIREBASE_AUTH_DOMAIN", "FIREBASE_APP_ID"):
        if not env.get(key):
            raise ConfigurationError(f"{key} is required")
    if env["FIREBASE_PROJECT_ID"].startswith("demo-"):
        raise ConfigurationError("Use a real Firebase project")
    if services["frontend"]["environment"].get("AUTH_PUBLIC_URL") != env["AUTH_PUBLIC_URL"]:
        raise ConfigurationError("Frontend and backend origins must match")
    proxy_ip = services["nginx"]["networks"]["default"]["ipv4_address"]
    network = config["networks"]["default"]["ipam"]["config"][0]
    subnet = ipaddress.IPv4Network(network["subnet"])
    dynamic = ipaddress.IPv4Network(network["ip_range"])
    proxy = ipaddress.IPv4Address(proxy_ip)
    if (not dynamic.subnet_of(subnet) or proxy not in subnet or proxy in dynamic
            or proxy in (subnet.network_address, subnet.broadcast_address, subnet.network_address + 1)):
        raise ConfigurationError("Nginx IP must be in the app subnet and outside gateway and dynamic allocation range")
    for name in ("frontend", "backend"):
        if services[name]["environment"].get("TRUSTED_PROXY_CIDRS") != proxy_ip + "/32":
            raise ConfigurationError("Only the Nginx IP may be trusted as a proxy")
    for name, service in services.items():
        if service.get("ports"):
            raise ConfigurationError(f"Host ports must not be published: {name}")
    tunnel_members = {name for name, service in services.items() if "tunnel" in service.get("networks", {})}
    if tunnel_members != {"nginx", "cloudflared"} or set(services["cloudflared"]["networks"]) != {"tunnel"}:
        raise ConfigurationError("Tunnel network must connect only cloudflared and nginx")
    if config.get("name") != "mobile-tracer-public":
        raise ConfigurationError("Use the separate mobile-tracer-public Compose project")
    if not check_files:
        return
    root = Path(__file__).resolve().parent.parent
    mounts = (("backend", "/run/secrets/firebase-admin.json"), ("cloudflared", "/run/secrets/tunnel-token"))
    for service, target in mounts:
        if service == "cloudflared" and not include_tunnel:
            continue
        mount = next((v for v in services[service].get("volumes", []) if v["target"] == target), None)
        if not mount or not mount.get("read_only"):
            raise ConfigurationError(f"Read-only secret file mount required: {service}")
        path = Path(mount["source"]).resolve()
        if not path.is_file() or path.stat().st_size == 0:
            raise ConfigurationError(f"Nonempty secret file required: {service}")
        if path.is_relative_to(root):
            if not path.is_relative_to(root / "secrets"):
                raise ConfigurationError("Repository secrets must be stored under ignored secrets/")
            relative = str(path.relative_to(root))
            tracked = subprocess.run(
                ["git", "-C", str(root), "ls-files", "--error-unmatch", "--", relative],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            ).returncode == 0
            ignored = subprocess.run(
                ["git", "-C", str(root), "check-ignore", "--no-index", "--quiet", "--", relative],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            ).returncode == 0
            if tracked or not ignored:
                raise ConfigurationError("Repository secrets must be untracked and ignored by Git")
        stat = path.stat()
        uid = int(services[service]["user"].split(":")[0])
        if uid == 0 or stat.st_uid != uid or stat.st_mode & 0o077:
            raise ConfigurationError(f"Secret must be owned by non-root container UID, mode 600: {service}")
        if service == "backend":
            credentials = json.loads(path.read_text())
            if (credentials.get("type") != "service_account"
                    or credentials.get("project_id") != env["FIREBASE_PROJECT_ID"]
                    or not credentials.get("private_key") or not credentials.get("client_email")):
                raise ConfigurationError("Firebase Admin credentials must match the Web app project")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--internal", action="store_true", help="Check internal services before the Tunnel token is available")
    parser.add_argument("--env-file", type=Path, help="Validate the environment file before Compose reads it")
    parser.add_argument("--env-only", action="store_true", help="Validate only the environment file metadata")
    args = parser.parse_args()
    if args.env_only and args.env_file is None:
        parser.error("--env-only requires --env-file")
    try:
        if args.env_file is not None:
            validate_env_file(args.env_file)
        if not args.env_only:
            validate(json.load(sys.stdin), include_tunnel=not args.internal)
    except ConfigurationError as error:
        print(f"Public configuration check failed: {error}", file=sys.stderr)
        sys.exit(1)
    except (ValueError, KeyError, OSError, StopIteration):
        # Neither parser errors nor paths/values from secrets go into logs.
        print("Public configuration check failed. Check .env.public, secret ownership and docs/hosting.md.", file=sys.stderr)
        sys.exit(1)
    if args.env_only:
        # Preserve Compose's JSON/quiet output for callers of public.sh.
        sys.exit(0)
    elif args.internal:
        print("Internal configuration OK: HTTPS, real Firebase, private ports and Firebase credentials. Tunnel not checked.")
    else:
        print("Public configuration OK: HTTPS, real Firebase, private ports and protected secret files.")
