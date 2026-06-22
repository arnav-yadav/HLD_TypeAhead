// Loads data/queries.csv -> Postgres `queries` table.
//
// Fast path: streams the CSV straight into a COPY statement (pg-copy-style via
// the COPY ... FROM STDIN protocol), which is dramatically faster than 102k
// individual INSERTs. Idempotent: TRUNCATEs first so re-running gives a clean load.
//
// Run with: npm run seed
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { pool } from './pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');
const CSV_PATH = path.join(__dirname, '..', '..', 'data', 'queries.csv');

function csvEscape(v) {
  // Postgres COPY (text format) wants tabs/newlines/backslashes escaped.
  return String(v).replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

async function main() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`Dataset not found at ${CSV_PATH}. Did you copy queries.csv into data/?`);
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    console.log('Applying schema...');
    await client.query(fs.readFileSync(SCHEMA_PATH, 'utf8'));

    console.log('Truncating queries table for a clean load...');
    await client.query('TRUNCATE TABLE queries');

    console.log(`Loading ${CSV_PATH} via COPY...`);
    // Lazy import keeps pg-copy-streams optional if someone only runs the server.
    const { from: copyFrom } = await import('pg-copy-streams').catch(() => ({ from: null }));

    if (copyFrom) {
      await copyViaStream(client, copyFrom);
    } else {
      console.warn('pg-copy-streams not installed; falling back to batched multi-row inserts.');
      await copyViaBatchedInserts(client);
    }

    const { rows } = await client.query('SELECT COUNT(*)::int AS n FROM queries');
    console.log(`Done. queries table now has ${rows[0].n} rows (expected ~102682).`);
  } finally {
    client.release();
    await pool.end();
  }
}

async function copyViaStream(client, copyFrom) {
  const stream = client.query(copyFrom("COPY queries (query, count) FROM STDIN WITH (FORMAT text)"));
  const rl = readline.createInterface({ input: fs.createReadStream(CSV_PATH), crlfDelay: Infinity });
  let first = true;
  for await (const line of rl) {
    if (first) { first = false; continue; } // skip header
    if (!line) continue;
    const idx = line.lastIndexOf(',');
    const query = line.slice(0, idx);
    const count = line.slice(idx + 1);
    if (!query) continue;
    stream.write(`${csvEscape(query)}\t${count}\n`);
  }
  stream.end();
  await new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

async function copyViaBatchedInserts(client) {
  const rl = readline.createInterface({ input: fs.createReadStream(CSV_PATH), crlfDelay: Infinity });
  let first = true;
  let batch = [];
  const BATCH = 1000;
  const flush = async () => {
    if (batch.length === 0) return;
    const values = [];
    const params = [];
    batch.forEach((row, i) => {
      values.push(`($${i * 2 + 1}, $${i * 2 + 2})`);
      params.push(row.query, row.count);
    });
    await client.query(
      `INSERT INTO queries (query, count) VALUES ${values.join(',')} ON CONFLICT (query) DO NOTHING`,
      params
    );
    batch = [];
  };
  for await (const line of rl) {
    if (first) { first = false; continue; }
    if (!line) continue;
    const idx = line.lastIndexOf(',');
    const query = line.slice(0, idx);
    const count = Number(line.slice(idx + 1));
    if (!query) continue;
    batch.push({ query, count });
    if (batch.length >= BATCH) await flush();
  }
  await flush();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
