#!/bin/sh
set -eu
umask 077

data=/var/lib/tapyrus
mkdir -p "$data"
case "$TAPYRUS_NETWORK_ID" in ''|*[!0-9]*) echo 'Invalid TAPYRUS_NETWORK_ID' >&2; exit 1 ;; esac
if [ "$TAPYRUS_NETWORK_ID" -lt 1 ] || [ "$TAPYRUS_NETWORK_ID" -gt 4294967295 ]; then
    echo 'TAPYRUS_NETWORK_ID must be between 1 and 4294967295' >&2
    exit 1
fi
for value in "$TAPYRUS_RPC_USER" "$TAPYRUS_RPC_PASSWORD" "$TAPYRUS_WALLET"; do
    case "$value" in ''|*[!a-zA-Z0-9_-]*) echo 'RPC credentials and wallet must use letters, digits, _ or -' >&2; exit 1 ;; esac
done

if [ -f "$data/network.id" ] && [ "$(cat "$data/network.id")" != "$TAPYRUS_NETWORK_ID" ]; then
    echo 'Network ID differs from the existing volume. Use a separate Compose project.' >&2
    exit 1
fi
if [ -f "$data/wallet.name" ] && [ "$(cat "$data/wallet.name")" != "$TAPYRUS_WALLET" ]; then
    echo 'Wallet name differs from the existing volume.' >&2
    exit 1
fi
genesis="$data/genesis.$TAPYRUS_NETWORK_ID"
if [ -f "$genesis" ] && [ ! -s "$data/dev.keys" ]; then
    echo 'Existing genesis has no matching signing keys; refusing to replace it.' >&2
    exit 1
fi
if [ ! -s "$data/dev.keys" ]; then
    tapyrus-genesis -dev -generatekey > "$data/dev.keys.tmp"
    mv "$data/dev.keys.tmp" "$data/dev.keys"
fi
private_key=$(sed -n 's/^private key: //p' "$data/dev.keys")
public_key=$(sed -n 's/^public key: //p' "$data/dev.keys")
test -n "$private_key" && test -n "$public_key"
if [ ! -s "$genesis" ]; then
    tapyrus-genesis -dev -signblockpubkey="$public_key" -signblockprivatekey="$private_key" > "$genesis.tmp"
    mv "$genesis.tmp" "$genesis"
fi
printf '%s\n' "$TAPYRUS_NETWORK_ID" > "$data/network.id"
printf '%s\n' "$TAPYRUS_WALLET" > "$data/wallet.name"
cat > "$data/tapyrus.conf.tmp" <<EOF
dev=1
networkid=$TAPYRUS_NETWORK_ID
datadir=$data
server=1
txindex=1
discover=0
dnsseed=0
listen=0
connect=0
keypool=10
fallbackfee=0.00001
rpcuser=$TAPYRUS_RPC_USER
rpcpassword=$TAPYRUS_RPC_PASSWORD
[dev]
rpcbind=0.0.0.0
rpcallowip=0.0.0.0/0
rpcport=12381
EOF
mv "$data/tapyrus.conf.tmp" "$data/tapyrus.conf"
# Esplora prints its CLI configuration at startup. Read auth from a file so the
# password is not included in that configuration log.
mkdir -p /var/lib/tapyrus-auth
printf '%s:%s' "$TAPYRUS_RPC_USER" "$TAPYRUS_RPC_PASSWORD" > /var/lib/tapyrus-auth/.cookie.tmp
mv /var/lib/tapyrus-auth/.cookie.tmp /var/lib/tapyrus-auth/.cookie
echo 'Local Tapyrus dev configuration and genesis are ready.'
