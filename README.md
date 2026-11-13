# Kelvin MCP

Penn State ME 300 Engineering Thermodynamics course tools and opt-in learning records.

- Student connector: `https://kelvin-mcp.vercel.app/mcp` (first connection asks for PSU email and professor's course)
- Older account connector: `https://kelvin-mcp.vercel.app/mcp/account` (still supported)
- Student and professor dashboard: `https://kelvin-mcp.vercel.app/dashboard`

The MCP, OAuth runtime, and dashboard run in one Vercel project. A Neon Postgres database, provisioned through Vercel, stores accounts, OAuth state, course uploads, learning records, and aggregated usage. Nothing in the request path depends on Lance's Mac mini.

## Demo flow

On their first Claude connection, students enter a `@psu.edu` email and choose a professor's course in Kelvin's MCP sign-in flow. Kelvin remembers the choice and reuses the same student account on later connections. Students can ask Claude to use `list_professors` and `switch_professor` to change their active course; this keeps their account and earlier reflections. The student dashboard asks only for their email and does not offer a professor selector. Email ownership is **not verified**; use test data only. Existing password-protected student accounts remain separate and do not become available through email-only sign-in.

Professors create an account in the dashboard with a PSU email and password. Each professor gets a stock ME 300 course and can add more courses. Uploads are scoped to one course; PDF, TXT, MD, and CSV files up to 2 MB are accepted. Kelvin stores the extracted text, not the original file binary. The MCP makes that text available to students in the course through `list_course_files`, `search_course`, and `get_course_file`.

There are now two reference courses. `demo-me300` is a concept template. `oconnor-me300-su23` is Dr. Jacqueline O’Connor’s archived Summer 2023 section. Its 140-file Canvas source inventory is available to instructors in the dashboard; assessment solutions are listed there but are not sent through student MCP tools. The published student cards come from the real course material and remain marked with their source and preparation status. Instructor courses start with the concept template, then can override cards and teaching skills. Every edit creates a numbered course revision with the editor, time, and reason, and instructors can restore an earlier revision. Uploading a file with the same name creates a new file version.

Instructors can set a term start date. `course_map`, `search_course`, and `ask_kelvin` then include the current week and module, bringing current material forward while keeping earlier topics available for review. Dates and grading in the archived section stay labeled Summer 2023.

The MCP supports two ways to work. A client can browse `course_map` → `search_course` → `get_card`, or send a question to `ask_kelvin` for a grounded response from DeepSeek. The question-first tool returns the source card IDs and falls back to those cards when the model is unavailable. Qwen can replace the model backend later without changing the tool interface.

The professor dashboard shows 14-day request and reflection timelines and compares topic, misconception, question, and content use between the last seven days and the seven days before. It never exposes student names, emails, or raw questions. Course activity appears only after five distinct students contribute; each daily point and category also requires five distinct students. A clearly labeled synthetic preview is available for walkthroughs before a course has enough activity. The student dashboard shows that student's saved reflections and course content.

Each MCP request is recorded in Neon with a schema version, student/account ID, course ID and version, client family, method, tool arguments, response status, and duration. These events are the evidence layer. The professor can run a synthesis that labels individual students’ recent questions with DeepSeek and builds class trends only when at least five students contribute. Student summaries show up only in that student’s dashboard. Class conclusions link to aggregate counts and source event IDs. Model suggestions are labeled as suggestions. A student may import their own ChatGPT or Claude conversation JSON, or Gemini My Activity JSON, to add prompts to the learning summary; exports vary, so the importer reports the count it recognized.

The demo has student, instructor, researcher, and operator roles. Students use email-only sign-in. Instructors use a password and edit their own courses. Researchers see aggregate course trends. Operators can edit the shared reference courses. Provision the latter two roles with `node provision-role.mjs <operator|researcher> <psu-email> <name>` from an environment connected to the production database; the command generates a password once.

When a professor's course has fewer than five contributing students, the dashboard opens with labeled sample charts. These numbers are illustrative browser-side fixtures, never stored as student events or mixed into live analytics. A sample professor account can browse the real stock course content but cannot create courses or upload files.

## Development

Run `npm ci` and `npm test`. The test suite uses local temporary files. Production uses `DATABASE_URL`. The `agent/` folder contains the course cards and selected teaching skills bundled with the function.

The `kelvin-mcp` Vercel project builds this repository root and serves all routes. Production needs `DATABASE_URL` and `DEEPSEEK_API_KEY` for persistent accounts and reflection classification.

Luke has repository admin access. The GitHub Actions workflow runs tests and deploys the single Vercel project on every push to `main`, regardless of which teammate pushed. It uses the `VERCEL_TOKEN` repository Actions secret and `CI_DEPLOY_ENABLED=true` repository variable. Vercel's Hobby plan cannot connect a private organization repository through its built-in Git integration, so the workflow uploads the build with Vercel CLI. Keep the token, database credentials, and student records out of Git.
