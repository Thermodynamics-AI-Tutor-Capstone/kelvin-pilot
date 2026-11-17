# GB10 handoff

The Compose file joins Kelvin to the existing `ai-network`, which reaches NGINX and Ollama. Kelvin listens on port 3337 inside Docker. It serves the dashboard, MCP, and OAuth routes on that same port. PostgreSQL stays on the separate `kelvin-private` network. No additional frontend port is needed.

Please preload `qwen3:8b` into the shared Ollama service. The default `OLLAMA_MODEL` in `.env` must match the installed tag. Kelvin calls `http://ollama:11434/api/chat`; it does not run its own Ollama container or need Qdrant.

NGINX should use a certificate valid for `kelvin.me.psu.edu`, redirect HTTP to HTTPS, and preserve the URL path. The existing HTTP proxy already reaches the Kelvin app; keep its working upstream on port 3337. A representative HTTPS location block is:

```nginx
client_max_body_size 4m;
location / {
    proxy_pass http://kelvin:3337;
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

A certificate mismatch blocks the advertised OAuth URLs even if `http://kelvin.me.psu.edu/dashboard` loads. Verify the certificate without `curl -k`:

```sh
curl -fsS https://kelvin.me.psu.edu/ready
```

The site root redirects to `/dashboard`. The student connector URL remains `/mcp`; opening `/mcp` directly in a browser is not a dashboard test.

After `docker compose up -d --build`, check:

```sh
docker compose ps
curl -fsS https://kelvin.me.psu.edu/ready
curl -fsS https://kelvin.me.psu.edu/health
```

`/ready` checks the database and that Ollama lists the configured model. If it fails, `docker compose logs kelvin` and `docker compose logs db` show the application and database errors. The MCP URL is `https://kelvin.me.psu.edu/mcp`; the dashboard is `https://kelvin.me.psu.edu/dashboard`.
