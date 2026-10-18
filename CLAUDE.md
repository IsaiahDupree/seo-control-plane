# SEO Control Plane

Next.js App Router app: central **content requests**, **publish queue**, **publish confirmation**, and **analytics ingest** for Vercel base apps (pilot: EverReach).

## Conventions

- DB tables: `scp_*` (see `supabase/migrations/`)
- User audit: `lib/user-audit.ts` — `tryInsertUserAudit(db, row)` returns optional warning string for JSON `audit_warning`
- API key auth: `Authorization: Bearer <key>` + app id in URL path `/api/v1/apps/[appId]/...`
- Every deployable service: `GET /api/health`

## Commands

```bash
npm run dev
npm run build
```

## Content pipeline (batch)

1. `POST /keywords` — seed unassigned keywords.  
2. `POST /content/request` — batch size (“need N posts”).  
3. `POST /content/requests/:id/allocate` — ties keywords → `scp_content_briefs`, request → `processing`.  
4. `POST /briefs/:id/generate` (or `POST /generate` with `brief_id`) — LLM + QA; links article, keyword → `assigned`; when all briefs for the request are `complete`, request → `fulfilled`.

## Base app integration

Package: `@authority-os/seo-control-plane-adapter` in `packages/seo-adapter`.

- **`registerSeoControlPlaneApp`** — bootstrap with `SCP_REGISTER_SECRET` → `POST /api/apps/register` (returns `app`, `api_key`, optional `audit_warning`). Throws **`SeoControlPlaneHttpError`** on non-2xx (same as the client).
- **`createSeoControlPlaneClient`** — all `/api/v1/apps/[appId]/…` calls with `Authorization: Bearer` API key. Non-2xx responses throw **`SeoControlPlaneHttpError`** (`status`, `code`, `body`). Use **`isSeoControlPlaneHttpError`** for narrowing in `catch`.

Env on the base app: `SEO_CONTROL_PLANE_URL` (or `SCP_BASE_URL`), `SEO_CONTROL_PLANE_APP_ID` / `SCP_APP_ID`, `SEO_CONTROL_PLANE_API_KEY` / `SCP_API_KEY`. Many mutating routes return optional **`audit_warning`** if `scp_user_audit_log` insert fails; use **`GET …/audit-log`** to inspect actions.

## Docs

- PRD: `../docs/SEO-Control-Plane-Vercel-Blog-Mesh-PRD.md`
- Feature catalogue: `../docs/SEO-Control-Plane-Feature-Catalog-1000.md`

## Repo location

Canonical path in this monorepo: `SEO_Optimization/seo-control-plane`. ACD harness `launch-seo-control-plane-blog-mesh.sh` should point `--path` here.
