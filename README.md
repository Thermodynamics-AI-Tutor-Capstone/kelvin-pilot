# Kelvin MCP

Penn State ME 300 Engineering Thermodynamics course tools and opt-in learning records.

- Student connector: `https://kelvin-mcp.vercel.app/mcp` (first connection asks for PSU email and professor's course)
- Older account connector: `https://kelvin-mcp.vercel.app/mcp/account` (still supported)
- Student and professor dashboard: `https://kelvin-mcp.vercel.app/dashboard`

The MCP, OAuth runtime, and dashboard run in one Vercel project. A Neon Postgres database, provisioned through Vercel, stores accounts, OAuth state, course uploads, learning records, and aggregated usage. Nothing in the request path depends on Lance's Mac mini.

## Demo flow

On their first Claude connection, students enter a `@psu.edu` email and choose a professor's course in Kelvin's MCP sign-in flow. Kelvin remembers the choice and reuses the same student account on later connections. Students can ask Claude to use `list_professors` and `switch_professor` to change their active course; this keeps their account and earlier reflections. The student dashboard asks only for their email and does not offer a professor selector. Email ownership is **not verified**; use test data only. Existing password-protected student accounts remain separate and do not become available through email-only sign-in.

Professors create an account in the dashboard with a PSU email and password. Each professor gets a stock ME 300 course and can add more courses. Uploads are scoped to one course; PDF, TXT, MD, and CSV files up to 2 MB are accepted. Kelvin stores the extracted text, not the original file binary. The MCP makes that text available to students in the course through `list_course_files`, `search_course`, and `get_course_file`.

The professor dashboard shows 14-day request and reflection timelines and compares topic, misconception, question, and content use between the last seven days and the seven days before. It never exposes student names, emails, or raw questions. Course activity appears only after five distinct students contribute; each daily point and category also requires five distinct students. A clearly labeled synthetic preview is available for walkthroughs before a course has enough activity. The student dashboard shows that student's saved reflections and course content.

## Development

Run `npm ci` and `npm test`. The test suite uses local temporary files. Production uses `DATABASE_URL`. The `agent/` folder contains the course cards and selected teaching skills bundled with the function.

The `kelvin-mcp` Vercel project builds this repository root and serves all routes. Production needs `DATABASE_URL` and `DEEPSEEK_API_KEY` for persistent accounts and reflection classification.

Luke has repository admin access. The GitHub Actions workflow runs tests and deploys the single Vercel project on every push to `main`, regardless of which teammate pushed. It uses the `VERCEL_TOKEN` repository Actions secret and `CI_DEPLOY_ENABLED=true` repository variable. Vercel's Hobby plan cannot connect a private organization repository through its built-in Git integration, so the workflow uploads the build with Vercel CLI. Keep the token, database credentials, and student records out of Git.
