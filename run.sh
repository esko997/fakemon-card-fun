#!/usr/bin/env bash
# Start the card maker on https://<this-machine>:${PORT:-8443}
set -euo pipefail
cd "$(dirname "$0")"

if [[ ! -x .venv/bin/python ]]; then
  python3 -m venv .venv
fi
if [[ ! -f .venv/.installed ]] || [[ requirements.txt -nt .venv/.installed ]]; then
  .venv/bin/pip install -q -r requirements.txt
  touch .venv/.installed
fi

./scripts/make-certs.sh data/certs

port="${PORT:-8443}"
# The address of the interface that routes outward is the one the tablet can reach (skips docker bridges).
lan_ip="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") print $(i + 1)}')"
echo "Card maker running. On the tablet open: https://${lan_ip:-<this-machine-ip>}:${port}"
echo "Grown-ups page: /parent.html   Tablet certificate: /ca.crt"

exec .venv/bin/uvicorn fakemon.app:create_app --factory \
  --host 0.0.0.0 --port "$port" \
  --ssl-keyfile data/certs/server.key --ssl-certfile data/certs/server.crt
