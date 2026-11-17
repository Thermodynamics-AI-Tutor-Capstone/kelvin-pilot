#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
if [ ! -s secrets/db_password.txt ]; then
  printf '%s\n' 'Missing database secret. Run ./scripts/init-gb10.sh first.' >&2
  exit 1
fi
if [ ! -f .env ]; then
  printf '%s\n' 'Missing .env. Run ./scripts/init-gb10.sh first.' >&2
  exit 1
fi
docker network inspect ai-network >/dev/null
docker compose config --quiet
printf '%s\n' 'Compose configuration and ai-network are ready.'
