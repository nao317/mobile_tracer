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
# Check the actual chain rather than trusting an old initialization marker.
height=$(sh /opt/tapyrus/rpc.sh getblockcount)
case "$height" in ''|*[!0-9]*) echo 'Invalid Tapyrus block height.' >&2; exit 1 ;; esac
if [ "$height" -lt 101 ]; then
    missing=$((101 - height))
    sh /opt/tapyrus/mine.sh "$missing" > /dev/null
    echo "Generated $missing missing local development blocks."
fi
# A stopped single-node dev chain can have an old tip and report initial sync
# after restarting. Generate one fresh block only when Core says it is needed.
sync=$(sh /opt/tapyrus/rpc.sh getblockchaininfo | sed -n 's/.*"initialblockdownload": *\(true\|false\).*/\1/p')
case "$sync" in
    true)
        sh /opt/tapyrus/mine.sh 1 > /dev/null
        echo 'Generated a fresh local development block to resume the chain.'
        ;;
    false) ;;
    *) echo 'Could not determine Tapyrus synchronization state.' >&2; exit 1 ;;
esac
touch "$data/bootstrapped"
echo 'Local wallet and test coins are ready.'
