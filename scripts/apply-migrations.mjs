/**
 * Applies all SQL migration files to Supabase via the pg REST connection.
 * Usage: SUPABASE_DB_PASSWORD=xxx node scripts/apply-migrations.mjs
 *
 * Alternatively set SUPABASE_ACCESS_TOKEN for Management API access.
 */
import { readFileSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const projectRef = SUPABASE_URL.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1]
if (!projectRef) {
  console.error('Could not parse project ref from URL:', SUPABASE_URL)
  process.exit(1)
}

if (!ACCESS_TOKEN) {
  console.error('Missing SUPABASE_ACCESS_TOKEN (personal access token)')
  console.error('Get one at: https://supabase.com/dashboard/account/tokens')
  process.exit(1)
}

const migrationsDir = join(__dirname, '..', 'supabase', 'migrations')
const files = readdirSync(migrationsDir)
  .filter(f => f.endsWith('.sql') && !f.startsWith('APPLY_ALL'))
  .sort()

console.log(`Project: ${projectRef}`)
console.log(`Found ${files.length} migration files:\n`)

async function runSql(sql) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
      },
      body: JSON.stringify({ query: sql }),
    }
  )
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = { raw: text } }
  return { status: res.status, ok: res.ok, body: json }
}

for (const file of files) {
  const sql = readFileSync(join(migrationsDir, file), 'utf8')
  process.stdout.write(`  ${file} ... `)
  const result = await runSql(sql)
  if (result.ok || result.status === 200) {
    console.log('✓')
  } else {
    console.log(`✗ (HTTP ${result.status})`)
    console.error('  Error:', JSON.stringify(result.body, null, 2).slice(0, 400))
  }
}

console.log('\nDone.')
