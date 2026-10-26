#!/usr/bin/env python3
"""Send and confirm a test transfer, then check state survives a restart."""

import json

from tapyrus_common import compose, get_json, rpc, wait_for_index


def main():
    before = wait_for_index()
    wallet = rpc("getwalletinfo")["walletname"]
    balance = rpc("getbalance")
    if balance <= 0:
        raise RuntimeError("Dev wallet has no test coins")
    print("Sending a test transfer on the local dev chain...", flush=True)
    address = rpc("getnewaddress")
    txid = rpc("sendtoaddress", address, 1)
    compose("exec", "-T", "tapyrusd", "sh", "/opt/tapyrus/mine.sh", "1")
    after = wait_for_index()
    transaction = rpc("gettransaction", txid)
    if transaction["confirmations"] < 1 or after["height"] <= before["height"]:
        raise RuntimeError("Test transaction was not confirmed")
    # Query the indexed transaction from the backend container too.
    status = json.loads(compose(
        "exec", "-T", "backend", "wget", "-qO-",
        f"http://esplora:3000/tx/{txid}/status",
    ))
    if not status["confirmed"] or status["block_hash"] != transaction["blockhash"]:
        raise RuntimeError("Core and Esplora transaction confirmation differs")
    print(f"Confirmed txid={txid}; checking persistence after restart...", flush=True)
    balance_after = rpc("getbalance")
    # Esplora resolves the Core hostname at startup. Restart in dependency order.
    compose("stop", "esplora")
    compose("restart", "tapyrusd")
    # Bootstrap loads the named wallet if it was not automatically reloaded.
    compose("run", "--rm", "--no-deps", "tapyrus-bootstrap")
    compose("restart", "esplora")
    restored = wait_for_index()
    if restored != after:
        raise RuntimeError("Chain or index changed after restart")
    if rpc("getwalletinfo")["walletname"] != wallet or rpc("getbalance") != balance_after:
        raise RuntimeError("Wallet state changed after restart")
    if rpc("gettransaction", txid)["confirmations"] < 1:
        raise RuntimeError("Transaction was lost after restart")
    if get_json("/api/health") != {"status": "ok"} or get_json("/api/ready") != {"status": "ok"}:
        raise RuntimeError("API failed after dependency restart")
    print(f"Confirmed txid={txid}; chain, index and wallet survived restart at height {restored['height']}")


if __name__ == "__main__":
    main()
