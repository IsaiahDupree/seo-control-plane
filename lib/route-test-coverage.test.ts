import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function walk(dir: string): string[] {
  const out: string[] = []
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.')) continue
    if (ent.name === 'node_modules') continue
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

describe('route test coverage', () => {
  it('has a colocated route.test.ts for every app/**/route.ts', () => {
    const repoRoot = process.cwd()
    const appDir = path.join(repoRoot, 'app')
    if (!fs.existsSync(appDir)) {
      throw new Error(`Expected app/ directory at ${appDir}`)
    }

    const files = walk(appDir)
    const routeFiles = files.filter((f) => f.endsWith(`${path.sep}route.ts`))

    const missing: string[] = []
    for (const r of routeFiles) {
      const d = path.dirname(r)
      const t = path.join(d, 'route.test.ts')
      if (!fs.existsSync(t)) {
        missing.push(path.relative(repoRoot, r))
      }
    }

    expect(missing).toEqual([])
  })
})

