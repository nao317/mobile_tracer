#!/bin/sh
set -eu
exec tapyrus-cli -conf=/var/lib/tapyrus/tapyrus.conf -rpcconnect=tapyrusd \
    -rpcwallet="$(cat /var/lib/tapyrus/wallet.name)" -stdin "$@"
