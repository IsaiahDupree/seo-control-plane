/**
 * Apply all SCP migrations via pg direct connection.
 * Usage: SUPABASE_DB_PASSWORD=xxx node scripts/migrate.mjs
 *
 * Password found in Supabase Dashboard → Settings → Database → Connection string
 */
import { readFileSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import pkg from 'pg'
const { Client } = pkg

const __dirname = dirname(fileURLToPath(import.meta.url))

const PROJECT_REF = 'ivhfuhxorppptyuofbgq'
const DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD

if (!DB_PASSWORD) {
  console.error('Missing SUPABASE_DB_PASSWORD')
  console.error('Get it from: Supabase Dashboard → Settings → Database → Database password')
  process.exit(1)
}

const client = new Client({
  host: `db.${PROJECT_REF}.supabase.co`,
  port: 5432,
  database: 'postgres',
  user: 'postgres',
  password: DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
})

const migrationsDir = join(__dirname, '..', 'supabase', 'migrations')
const files = readdirSync(migrationsDir)
  .filter(f => f.endsWith('.sql') && !f.startsWith('APPLY_ALL'))
  .sort()

console.log(`Connecting to db.${PROJECT_REF}.supabase.co ...`)
await client.connect()
console.log('Connected.\n')

let ok = 0
let fail = 0

for (const file of files) {
  const sql = readFileSync(join(migrationsDir, file), 'utf8')
  process.stdout.write(`  ${file} ... `)
  try {
    await client.query(sql)
    console.log('✓')
    ok++
  } catch (err) {
    // Ignore "already exists" errors for idempotency
    if (err.message.includes('already exists')) {
      console.log('✓ (already applied)')
      ok++
    } else {
      console.log('✗')
      console.error(`    ${err.message.slice(0, 200)}`)
      fail++
    }
  }
}

await client.end()
console.log(`\nDone. ${ok} succeeded, ${fail} failed.`)
