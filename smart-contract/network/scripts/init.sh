#!/bin/bash
# Membangkitkan genesis QBFT + 4 key validator sekali saja (idempotent) ke volume /config.
set -euo pipefail
if [ -f /config/genesis.json ]; then
  echo "[besu-init] konfigurasi sudah ada, dilewati"; exit 0
fi
rm -rf /config/tmp
/opt/besu/bin/besu operator generate-blockchain-config \
  --config-file=/network/qbft-config.json --to=/config/tmp --private-key-file-name=key
i=1
for dir in $(ls -d /config/tmp/keys/*/ | sort); do
  mkdir -p "/config/validator$i"
  cp "$dir/key" "/config/validator$i/key"
  cp "$dir/key.pub" "/config/validator$i/key.pub"
  i=$((i+1))
done
cp /config/tmp/genesis.json /config/genesis.json
rm -rf /config/tmp
chmod -R a+rX /config
echo "[besu-init] genesis + 4 validator key dibuat"
