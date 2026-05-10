import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET = process.env.SUPABASE_SECRET;

if (!SUPABASE_URL || !SUPABASE_SECRET) {
  console.error('Missing SUPABASE_URL or SUPABASE_SECRET env vars');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET);

const tables = ['agents', 'customer_groups', 'nominees', 'companies', 'accounts'];

async function backup() {
  const date = new Date();
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const dateStr = `${yyyy}-${mm}-${dd}`;

  const backupDir = join('backups', dateStr);
  if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true });

  const summary = { date: dateStr, timestamp: date.toISOString(), tables: {} };

  for (const table of tables) {
    console.log(`Backing up ${table}...`);
    const { data, error } = await supabase.from(table).select('*');
    if (error) {
      console.error(`Failed to backup ${table}:`, error.message);
      summary.tables[table] = { error: error.message };
      continue;
    }
    const filepath = join(backupDir, `${table}.json`);
    writeFileSync(filepath, JSON.stringify(data, null, 2));
    summary.tables[table] = { rows: data.length, file: `${table}.json` };
    console.log(`  ✓ ${data.length} rows → ${filepath}`);
  }

  // Write summary
  writeFileSync(join(backupDir, '_summary.json'), JSON.stringify(summary, null, 2));

  // Update latest pointer
  writeFileSync('backups/_latest.json', JSON.stringify(summary, null, 2));

  console.log(`\n✅ Backup complete: ${backupDir}`);
}

backup().catch(e => {
  console.error('Backup failed:', e);
  process.exit(1);
});
