# GB10 handoff

The only host-specific Compose setting we need from Gary is the name of the existing Docker network that reaches both NGINX and Ollama. Set it as `GB10_SHARED_NETWORK` in `.env`. Kelvin joins that network as `kelvin-pilot` and listens on port 3337 inside Docker. PostgreSQL stays on a separate private network.

Please preload `qwen3:8b` into the shared Ollama service. The default `OLLAMA_MODEL` in `.env` must match the installed tag. Kelvin calls `http://ollama:11434/api/chat`; it does not run its own Ollama container or need Qdrant.

NGINX should terminate TLS for `kelvin.me.psu.edu` and preserve the URL path. A representative location block is:

```nginx
client_max_body_size 4m;
location / {
    proxy_pass http://kelvin-pilot:3337;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_read_timeout 120s;
    proxy_send_timeout 120s;
    proxy_buffering off;
}
```

Compose sets `KELVIN_PUBLIC_ORIGIN=https://kelvin.me.psu.edu`, which the MCP OAuth flow uses for its issuer and callback URLs. It trusts one proxy hop, matching the NGINX setup above. If the request passes through another proxy, check the forwarding chain before changing `KELVIN_TRUST_PROXY_HOPS`.

After `docker compose up -d --build`, check:

```sh
docker compose ps
curl -fsS https://kelvin.me.psu.edu/ready
curl -fsS https://kelvin.me.psu.edu/health
```

`/ready` checks the database and that Ollama lists the configured model. If it fails, `docker compose logs kelvin` and `docker compose logs db` show the application and database errors. The MCP URL is `https://kelvin.me.psu.edu/mcp`; the dashboard is `https://kelvin.me.psu.edu/dashboard`.
