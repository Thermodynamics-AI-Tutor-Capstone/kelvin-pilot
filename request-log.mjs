import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const dataDir = process.env.KELVIN_MCP_DATA_DIR || join(import.meta.dirname, 'data');
const logDir = join(dataDir, 'request-logs');
const fileLogs = process.env.VERCEL !== '1' && process.env.KELVIN_LOG_TO_STDOUT_ONLY !== '1';
if (fileLogs) mkdirSync(logDir, { recursive: true, mode: 0o700 });

export function writeRequestLog(event) {
  const line = JSON.stringify(event);
  if (fileLogs) appendFileSync(join(logDir, `${event.at.slice(0, 10)}.jsonl`), `${line}\n`, { mode: 0o600 });
  console.log(line);
}
