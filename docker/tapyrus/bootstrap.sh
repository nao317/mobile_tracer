#!/bin/sh
set -eu
umask 077
data=/var/lib/tapyrus
wallet=$(cat "$data/wallet.name")
attempt=0
until tapyrus-cli -conf="$data/tapyrus.conf" -rpcconnect=tapyrusd getblockcount > /dev/null 2>&1; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 60 ]; then
        echo 'Tapyrus RPC did not become ready within 60 seconds.' >&2
        exit 1
    fi
    sleep 1
done
if ! sh /opt/tapyrus/rpc.sh getwalletinfo > /dev/null 2>&1; then
    if ! tapyrus-cli -conf="$data/tapyrus.conf" -rpcconnect=tapyrusd loadwallet "$wallet" > /dev/null 2>&1; then
        tapyrus-cli -conf="$data/tapyrus.conf" -rpcconnect=tapyrusd createwallet "$wallet" > /dev/null
    fi
fi
if [ ! -s "$data/mining.address" ]; then
    sh /opt/tapyrus/rpc.sh getnewaddress > "$data/mining.address.tmp"
    # tapyrus-cli prints a string result without JSON quotes.
    mv "$data/mining.address.tmp" "$data/mining.address"
fi
if [ ! -f "$data/bootstrapped" ]; then
    sh /opt/tapyrus/mine.sh 101 > /dev/null
    touch "$data/bootstrapped"
fi
echo 'Local wallet and test coins are ready.'
