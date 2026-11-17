# Kelvin pilot for the GB10

This is the GB10 deployment repository for Kelvin. It was copied from the [Vercel demo](https://github.com/Thermodynamics-AI-Tutor-Capstone/kelvin-mcp), but it has its own code, database, model connection, and release process. Changes here do not deploy the demo.

Kelvin serves the student MCP at `https://kelvin.me.psu.edu/mcp` and the student and professor dashboard at `https://kelvin.me.psu.edu/dashboard`. Gary's NGINX container handles HTTPS and forwards requests to the Kelvin container. Docker Compose runs Kelvin and a private PostgreSQL database. Kelvin sends model requests to the GB10's shared Ollama service at `http://ollama:11434`. Qdrant is not needed for this version.

## Bring it up on the GB10

1. Clone this private repository onto the GB10.
2. Ask Gary for the name of the Docker network shared by NGINX and Ollama, and ask him to preload **`qwen3:8b`** in Ollama. The model tag can be changed in `.env`.
3. Run `./scripts/init-gb10.sh`. It creates `.env` and a random database password in `secrets/db_password.txt`; neither file belongs in Git.
4. Set `GB10_SHARED_NETWORK` in `.env` to the network name from Gary. Run `./scripts/preflight-gb10.sh`.
5. Run `docker compose up -d --build`, then `docker compose ps`.
6. Have NGINX forward `kelvin.me.psu.edu` to `http://kelvin-pilot:3337` on that shared network. [GB10 handoff details](docs/GB10-HANDOFF.md) include the required proxy headers and timeouts.
7. Check `https://kelvin.me.psu.edu/ready`. It should report `ready: true`, with both `database` and `model` true.

### If Kelvin cannot read the database password

On the GB10, `init-gb10.sh` creates `secrets/db_password.txt` with mode `600`. Docker Compose bind-mounts that file as a secret, but the image runs as the `node` user (UID 1000). On this shared host, UID 1000 belongs to the host's `administrator` account. Do not grant that account access to Kelvin's password file.

If `docker compose ps` leaves Kelvin at `health: starting` or `unhealthy`, check `/ready` inside the container:

```sh
docker compose exec -T kelvin node -e "fetch('http://127.0.0.1:3337/ready').then(async r => console.log(r.status, await r.text()))"
```

If it reports `database: false`, check the error without printing the password:

```sh
docker compose exec -T kelvin node -e "import('./persistence.mjs').then(m => m.storedEvents()).then(() => console.log('DB query OK')).catch(e => { console.error(e.message); process.exitCode = 1 })"
```

For `EACCES: permission denied, open '/run/secrets/kelvin_db_password'`, create a **local** Compose override so only the Kelvin process runs as the host user who owns the file. Run these commands from `/opt/docker/kelvin` and first confirm `docker-compose.override.yml` does not already exist:

```sh
ls docker-compose.override.yml
printf 'services:\n  kelvin:\n    user: "%s:%s"\n' "$(id -u)" "$(id -g)" > docker-compose.override.yml
docker compose config --quiet
docker compose up -d --no-deps kelvin
docker compose exec -T kelvin sh -c 'test -r /run/secrets/kelvin_db_password && echo readable'
docker compose exec -T kelvin node -e "fetch('http://127.0.0.1:3337/ready').then(async r => console.log(r.status, await r.text()))"
```

The final response should be HTTP 200 with `database: true` and `model: true`. Keep the override on this host for future `docker compose up -d --build` runs. It is ignored by Git because it contains a machine-specific UID. If an override already exists, merge the `user` setting into it instead of replacing it.

The database is stored in the `postgres_data` Docker volume. It starts empty and does **not** copy accounts or student records from the Vercel demo. There is no exposed database port. Application request logs go to Docker logs; MCP event records go to PostgreSQL.

## Updating and operating

Pull the desired commit and run `docker compose up -d --build`. The database volume stays in place. `docker compose logs -f kelvin` shows application and request logs. Back up the database before significant updates:

```sh
docker compose exec -T db pg_dump -U kelvin -d kelvin -Fc > kelvin-backup.dump
```

GitHub Actions runs the Node tests, validates Compose, and builds the image. It does not deploy to the GB10; Gary or the operator controls that host.

## Current pilot boundary

The copied app still uses the demo's email-only student flow. Email ownership is not verified, so this build is for setup and controlled testing until Penn State provides an approved identity path. The repository includes the real ME 300 course cards and the student-facing transcripts already used by the demo. Course files, accounts, and usage recorded on the GB10 stay in its own database.

The configured default model is [Ollama `qwen3:8b`](https://ollama.com/library/qwen3%3A8b). Kelvin uses it for question-first tutoring, reflection classification, and course synthesis. Direct course browsing still works if the model is unavailable, while `/ready` reports that the full service is not ready.

The `socratic-tutor` teaching skill comes from [Jane Street's agent_skills](https://github.com/janestreet/agent_skills/tree/7c6715c29548a3b39d4a9545c698ee4fd17a7213/socratic-tutor). Kelvin offers it through `list_teaching_skills` and `get_teaching_skill` when a student asks for an ongoing lesson or quiz. It is not the default for a one-off question. The upstream MIT license is included beside the skill.
