# Kelvin MCP

Penn State ME 300 Engineering Thermodynamics course tools and opt-in learning records.

- Public course connector: `https://kelvin-mcp.vercel.app/mcp` (no sign-in)
- Student account connector: `https://kelvin-mcp-account.vercel.app/mcp/account` (OAuth)
- Professor dashboard: `https://kelvin-professor-dashboard.vercel.app`

The MCP and OAuth runtime run in Vercel Functions. A Neon Postgres database, provisioned through Vercel, stores accounts, OAuth state, and learning records. The dashboard uses the account function. Nothing in the request path depends on Lance's Mac mini.

## Development

Run `npm ci` and `npm test`. The test suite uses local temporary files. Production uses `DATABASE_URL`. The `agent/` folder contains the course cards and selected teaching skills bundled with the function.

The two MCP Vercel projects build this repository root. Set `KELVIN_HOST_MODE=public` on `kelvin-mcp` and `KELVIN_HOST_MODE=account` on `kelvin-mcp-account`. The account project also needs the same database connection. The professor dashboard project builds `dashboard/` from this repository.

Luke has repository admin access. The GitHub Actions workflow runs tests and deploys all three Vercel projects on pushes to `main`. It needs a `VERCEL_TOKEN` repository Actions secret with access to those projects. Vercel's Hobby plan cannot connect a private organization repository through its built-in Git integration, so the workflow uploads the builds with Vercel CLI. Keep the token, database credentials, and student records out of Git.
