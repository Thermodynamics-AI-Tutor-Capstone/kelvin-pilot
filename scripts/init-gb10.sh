#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
umask 077
if [ ! -f .env ]; then cp .env.example .env; fi
mkdir -p secrets
if [ ! -f secrets/db_password.txt ]; then
  openssl rand -hex 32 > secrets/db_password.txt
fi
chmod 600 .env secrets/db_password.txt
printf '%s\n' 'Host files are ready. Run ./scripts/preflight-gb10.sh, then docker compose up -d --build.'
