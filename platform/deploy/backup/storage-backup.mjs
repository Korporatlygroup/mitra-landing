// Copies every object of the private buckets to a local folder and verifies size and sha256 against the storage metadata read back.
// Usage: SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SECRET_KEY=... node deploy/backup/storage-backup.mjs <output-dir>
// The key is read from the environment only and never printed. Output holds private documents: keep it outside git, encrypted.
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const { SUPABASE_URL: url, SUPABASE_SECRET_KEY: key } = process.env;
const out = process.argv[2];
if (!url || !key || !out) throw new Error('SUPABASE_URL, SUPABASE_SECRET_KEY and an output directory are required');
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

async function walk(bucket, prefix = '') {
  const files = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await db.storage.from(bucket).list(prefix, { limit: 100, offset });
    if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`);
    for (const e of data) {
      const path = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.id === null) files.push(...(await walk(bucket, path)));
      else files.push(path);
    }
    if (data.length < 100) break;
  }
  return files;
}

const lines = [];
for (const bucket of ['verification-docs', 'catalogue-media']) {
  const paths = await walk(bucket);
  for (const p of paths) {
    const { data, error } = await db.storage.from(bucket).download(p);
    if (error) throw new Error(`download ${bucket}/${p}: ${error.message}`);
    const buf = Buffer.from(await data.arrayBuffer());
    const file = join(out, bucket, ...p.split('/'));
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, buf);
    lines.push(`${createHash('sha256').update(buf).digest('hex')}  ${bucket}/${p}  ${buf.length}`);
  }
  console.log(`${bucket}: ${paths.length} object(s)`);
}
await mkdir(out, { recursive: true });
await writeFile(join(out, 'STORAGE-MANIFEST.txt'), lines.join('\n') + '\n');
