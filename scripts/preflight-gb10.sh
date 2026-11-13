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
set -a
. ./.env
set +a
if [ -z "${GB10_SHARED_NETWORK:-}" ]; then
  printf '%s\n' 'Set GB10_SHARED_NETWORK in .env to the shared Docker network.' >&2
  exit 1
fi
docker network inspect "$GB10_SHARED_NETWORK" >/dev/null
docker compose config --quiet
printf '%s\n' 'Compose configuration and shared network are ready.'
