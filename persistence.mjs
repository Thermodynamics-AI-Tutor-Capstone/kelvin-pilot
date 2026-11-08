import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const dataDir = process.env.KELVIN_MCP_DATA_DIR || join(import.meta.dirname, 'data');
const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
let pool;
let schemaReady;

async function database() {
  if (!databaseUrl) return null;
  if (!pool) {
    const { Pool } = await import('pg');
    pool = new Pool({ connectionString: databaseUrl, max: 3, idleTimeoutMillis: 10000 });
  }
  if (!schemaReady) schemaReady = (async () => {
    await pool.query('CREATE TABLE IF NOT EXISTS kelvin_state (key text PRIMARY KEY, value jsonb NOT NULL)');
    await pool.query('CREATE TABLE IF NOT EXISTS kelvin_events (id uuid PRIMARY KEY, at timestamptz NOT NULL, value jsonb NOT NULL)');
  })().catch(error => { schemaReady = null; throw error; });
  await schemaReady;
  return pool;
}

function localPath(key) { return join(dataDir, key); }
function localRead(key, fallback) {
  const path = localPath(key);
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback;
}
function localWrite(key, value) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const path = localPath(key), temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(value), { mode: 0o600 });
  renameSync(temp, path);
}

export async function readState(key, fallback) {
  const db = await database();
  if (!db) return localRead(key, fallback);
  const { rows } = await db.query('SELECT value FROM kelvin_state WHERE key = $1', [key]);
  return rows[0]?.value ?? fallback;
}

export async function mutateState(key, fallback, change) {
  const db = await database();
  if (!db) {
    const value = localRead(key, structuredClone(fallback));
    const result = await change(value);
    localWrite(key, value);
    return result;
  }
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO kelvin_state (key, value) VALUES ($1, $2::jsonb) ON CONFLICT DO NOTHING', [key, JSON.stringify(fallback)]);
    const { rows } = await client.query('SELECT value FROM kelvin_state WHERE key = $1 FOR UPDATE', [key]);
    const value = rows[0].value;
    const result = await change(value);
    await client.query('UPDATE kelvin_state SET value = $2::jsonb WHERE key = $1', [key, JSON.stringify(value)]);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

export async function addStoredEvent(event) {
  const value = { id: randomUUID(), at: new Date().toISOString(), ...event };
  const db = await database();
  if (db) await db.query('INSERT INTO kelvin_events (id, at, value) VALUES ($1, $2, $3::jsonb)', [value.id, value.at, JSON.stringify(value)]);
  else {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    appendFileSync(localPath('events.jsonl'), `${JSON.stringify(value)}\n`, { mode: 0o600 });
  }
  return value;
}

export async function storedEvents() {
  const db = await database();
  if (db) return (await db.query('SELECT value FROM kelvin_events ORDER BY at, id')).rows.map(row => row.value);
  const path = localPath('events.jsonl');
  return existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
}

export async function deleteStoredEvents(studentId) {
  const db = await database();
  if (db) return db.query("DELETE FROM kelvin_events WHERE value->>'studentId' = $1", [studentId]);
  const remaining = (await storedEvents()).filter(event => event.studentId !== studentId);
  const path = localPath('events.jsonl'), temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, remaining.map(event => JSON.stringify(event)).join('\n') + (remaining.length ? '\n' : ''), { mode: 0o600 });
  renameSync(temp, path);
}

export async function closePersistence() { if (pool) await pool.end(); }
