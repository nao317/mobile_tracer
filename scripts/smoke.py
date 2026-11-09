#!/usr/bin/env python3
"""Check Go API liveness and Core/Esplora agreement from the Go container."""

from tapyrus_common import get_json


def main():
    for path in ("/api/health", "/api/ready"):
        if get_json(path) != {"status": "ok"}:
            raise RuntimeError(f"Unexpected response from {path}")
    print("Application API and configured dependencies are ready")


if __name__ == "__main__":
    main()
