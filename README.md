# Kelvin MCP

Penn State ME 300 Engineering Thermodynamics course tools and opt-in learning records.

- Public course connector: `https://kelvin-mcp.vercel.app/mcp` (no sign-in)
- Student account connector: `https://kelvin-mcp.vercel.app/mcp/account` (OAuth)
- Professor dashboard: `https://kelvin-mcp.vercel.app/dashboard`

The MCP, OAuth runtime, and dashboard run in one Vercel project. A Neon Postgres database, provisioned through Vercel, stores accounts, OAuth state, and learning records. Nothing in the request path depends on Lance's Mac mini.

## Development

Run `npm ci` and `npm test`. The test suite uses local temporary files. Production uses `DATABASE_URL`. The `agent/` folder contains the course cards and selected teaching skills bundled with the function.

The `kelvin-mcp` Vercel project builds this repository root and serves all routes. Production needs `DATABASE_URL` and `DEEPSEEK_API_KEY` for persistent accounts and reflection classification.

Luke has repository admin access. The GitHub Actions workflow runs tests and deploys the single Vercel project on pushes to `main`. It needs the `VERCEL_TOKEN` repository Actions secret with access to `kelvin-mcp`. Vercel's Hobby plan cannot connect a private organization repository through its built-in Git integration, so the workflow uploads the build with Vercel CLI. Keep the token, database credentials, and student records out of Git.
