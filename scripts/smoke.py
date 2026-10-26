#!/usr/bin/env python3
"""Check Go API liveness and Core/Esplora agreement from the Go container."""

from tapyrus_common import check_chain, get_json


def main():
    for path in ("/api/health", "/api/ready"):
        if get_json(path) != {"status": "ok"}:
            raise RuntimeError(f"Unexpected response from {path}")
    chain = check_chain()
    if chain["mode"] != "dev" or chain["height"] < 101:
        raise RuntimeError("Expected a funded local dev chain")
    print(f"API healthy; Core and Esplora agree at height {chain['height']}")


if __name__ == "__main__":
    main()
