#!/bin/sh
set -eu
blocks=${1:-1}
case "$blocks" in ''|*[!0-9]*) echo 'Invalid block count' >&2; exit 1 ;; esac
test "$blocks" -gt 0
address=$(cat /var/lib/tapyrus/mining.address)
private_key=$(sed -n 's/^private key: //p' /var/lib/tapyrus/dev.keys)
printf '%s\n' "$blocks" "$address" "$private_key" | sh /opt/tapyrus/rpc.sh generatetoaddress
