#!/usr/bin/env bash
set -euo pipefail
public_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
public_env="${PUBLIC_ENV_FILE:-$public_root/.env.public}"
if [[ ! -f "$public_env" ]]; then
  echo 'Create .env.public from .env.public.example; see docs/hosting.md.' >&2
  exit 1
fi
public_compose=(docker compose --project-name mobile-tracer-public
  --env-file "$public_env" -f "$public_root/compose.yaml"
  -f "$public_root/compose.firebase.yaml" -f "$public_root/compose.public.yaml")
if [[ "${1:-}" == prepare ]]; then
  "${public_compose[@]}" config --format json | python3 "$public_root/scripts/public-check.py" --internal
  # Starting nginx also starts its internal dependencies, never cloudflared.
  exec "${public_compose[@]}" up -d --wait --wait-timeout 300 nginx
fi
if [[ "${1:-}" == check ]]; then
  "${public_compose[@]}" config --format json | python3 "$public_root/scripts/public-check.py"
  exit 0
fi
if [[ "${1:-}" == up ]]; then
  "${public_compose[@]}" config --format json | python3 "$public_root/scripts/public-check.py"
fi
exec "${public_compose[@]}" "$@"
