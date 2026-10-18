# seo-control-plane

Authority OS — SEO/GEO/AEO control plane built with Next.js (App Router) + Supabase.

## Requirements

- Node.js (LTS recommended)
- Supabase project configured in environment (see `.env.example` if present)

## Install

```bash
npm ci
```

## Local development

```bash
npm run dev
```

## Verification (must stay green)

This repo uses a single “golden” command:

```bash
npm run verify
```

It runs:

- ESLint with `--max-warnings 0`
- Vitest
- `next build`

## Optional local “hooks” (via npm scripts)

This project does not assume git hooks are installed. If you want a consistent convention for local checks, use:

```bash
npm run precommit
npm run prepush
```

## Testing conventions

- All Next.js `route.ts` handlers are required to have a colocated `route.test.ts`.
- A guard test (`lib/route-test-coverage.test.ts`) enforces this.
- Supabase query chains in tests should use helpers in `lib/testing/supabase-mocks.ts` (not hand-rolled `then()` mocks).

## CI

GitHub Actions runs `npm run verify` on pushes/PRs that touch `seo-control-plane/**`.

