#!/bin/bash
# Menjalankan satu validator. Argumen: <nomor validator> [opsi besu tambahan]
set -euo pipefail
N="$1"; shift
BOOT_PUB=$(sed 's/^0x//' /config/validator1/key.pub | tr -d '\r\n ')
ARGS=(--data-path=/data --genesis-file=/config/genesis.json --node-private-key-file=/config/validator$N/key
  --network-id=1337 --min-gas-price=0 --host-allowlist=* --p2p-host="$(hostname -i | awk '{print $1}')" --p2p-port=30303
  --sync-mode=FULL --logging=INFO)
if [ "$N" != "1" ]; then
  # Besu butuh IP untuk enode; resolve hostname validator1 di jaringan docker
  BOOT_IP=$(getent hosts validator1 | awk '{print $1}')
  ARGS+=(--bootnodes="enode://${BOOT_PUB}@${BOOT_IP}:30303")
fi
exec /opt/besu/bin/besu "${ARGS[@]}" "$@"
