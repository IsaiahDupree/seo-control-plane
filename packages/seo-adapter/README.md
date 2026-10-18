# seo-adapter

TypeScript client for the **SEO Control Plane** API. Drop it into any Next.js, Node, or edge runtime to interact with the control plane from your base application.

## Installation

```bash
# Package name (see package.json)
npm install @authority-os/seo-control-plane-adapter
```

## Quick Start

```ts
import { createSeoControlPlaneClient } from '@authority-os/seo-control-plane-adapter'

const scp = createSeoControlPlaneClient({
  baseUrl: process.env.SCP_BASE_URL!,   // e.g. https://scp.yourdomain.com
  appId:   process.env.SCP_APP_ID!,
  apiKey:  process.env.SCP_API_KEY!,
})

// Request a batch of new articles
await scp.requestContent(5, 'Focus on mid-funnel buyer intent')

// Seed keywords
await scp.seedKeywords([
  { keyword: 'best crm software', intent: 'commercial', search_volume: 12000, is_seed: true },
])
```

## Errors

Failed requests (non-2xx) and invalid JSON bodies throw **`SeoControlPlaneHttpError`**. Use `error.status`, optional **`error.code`** (from the API’s `error.code`), and **`error.body`** (parsed JSON when available). **`isSeoControlPlaneHttpError(e)`** is a small type guard (same as `instanceof`). Import next to the client:

```ts
import {
  createSeoControlPlaneClient,
  isSeoControlPlaneHttpError,
} from '@authority-os/seo-control-plane-adapter'

try {
  await scp.requestContent(3)
} catch (e) {
  if (isSeoControlPlaneHttpError(e)) {
    console.error(e.status, e.code, e.message)
  }
  throw e
}
```

### Provisioning a new app (register secret)

One-time bootstrap with `SCP_REGISTER_SECRET` on the control plane (not the per-app API key):

```ts
import {
  registerSeoControlPlaneApp,
  createSeoControlPlaneClient,
} from '@authority-os/seo-control-plane-adapter'

const out = await registerSeoControlPlaneApp({
  baseUrl: 'https://your-scp.example.com',
  registerSecret: process.env.SCP_REGISTER_SECRET!,
  slug: 'my-app',
  name: 'My App',
  base_url: 'https://myapp.example.com',
})

if (out.audit_warning) {
  console.warn('scp_user_audit_log:', out.audit_warning)
}

const scp = createSeoControlPlaneClient({
  baseUrl: 'https://your-scp.example.com',
  appId: out.app.id,
  apiKey: out.api_key,
})
```

---

## All Methods

### Provisioning (no per-app API key yet)
| Export | Description |
|---|---|
| `registerSeoControlPlaneApp(params)` | `POST /api/apps/register` — creates app + default key; optional `audit_warning` |

### App & API keys
| Method | Description |
|---|---|
| `getSettings()` | Read app config (no webhook secret) |
| `patchSettings(body)` | PATCH app config (name, URLs, metadata, monthly limit, webhook rotation) |
| `listApiKeys()` | List key metadata (prefix, label, revoked) |
| `createApiKey(body?)` | Mint a key; response includes plaintext once |
| `revokeApiKey(keyId)` | Revoke a key |

### Keywords
| Method | Description |
|---|---|
| `listKeywords(query?)` | List keywords with optional status/cluster/offset filter |
| `seedKeywords(rows)` | Bulk upsert keyword rows |
| `getKeyword(keywordId)` | Get single keyword |
| `patchKeyword(keywordId, body)` | Update cluster, status, priority |
| `listKeywordClusters()` | List distinct clusters with counts |
| `assignKeywordClusters(assignments)` | Bulk assign cluster names |
| `syncGscKeywords(rows)` | Upsert GSC query data (clicks, impressions, ctr, position) |
| `listGscPerformance(query?)` | Query historical GSC performance rows |

### Content Requests
| Method | Description |
|---|---|
| `requestContent(batchSize, notes?)` | Create a new content request batch |
| `getQueue(options?)` | List the content queue |
| `listContentRequests(query?)` | List all content requests |
| `getContentRequest(requestId)` | Get single content request |
| `allocateContentRequest(requestId)` | Claim a queued request |
| `patchContentRequest(requestId, body)` | Cancel (`{ status: 'cancelled' }`) or edit notes while open |
| `cancelContentRequest(requestId)` | Cancel an open request |
| `schedulePublish(body)` | Schedule approved articles for publication |
| `listPublishQueue(query?)` | List the publish queue |
| `confirmPublish(body)` | Mark article as published (optionally submit to IndexNow) |

### Briefs
| Method | Description |
|---|---|
| `listBriefs(query?)` | List briefs; use `all_statuses: true` to skip default `pending` filter |
| `getBrief(briefId)` | Get a single brief |
| `patchBrief(briefId, body)` | Update brief status/notes |
| `generateFromBrief(briefId, body?)` | Trigger generation for a brief |
| `processPendingBriefs(body?)` | Batch-process all pending briefs |

### Articles
| Method | Description |
|---|---|
| `listArticles(query?)` | List articles with status/offset filter |
| `getArticle(articleId)` | Get a single article |
| `patchArticle(articleId, body)` | Update article metadata/status |
| `generateArticle(body)` | Direct article generation without a brief |
| `deliverArticle(articleId)` | Trigger delivery of an article to the webhook |
| `getArticleInternalLinks(articleId)` | List saved internal link edges for an article |
| `postArticleInternalLinks(articleId, body?)` | Suggest and optionally inject (`{ inject: true }`) internal links |
| `getArticleQa(articleId, options?)` | Get QA report (latest or full history) |

### App-level experiments
| Method | Description |
|---|---|
| `listExperiments(query?)` | List experiments (optional `article_id`, `status` filters) |
| `createExperiment(body)` | Create experiment; body includes `article_id` |
| `getExperiment(experimentId)` | Get one experiment by id |
| `patchExperiment(experimentId, body)` | Update status, counters, winner, conclude |

### Article-scoped experiments
Prefer these when you already have `articleId` (responses include live `stats` where applicable).

| Method | Description |
|---|---|
| `listExperimentsForArticle(articleId)` | `GET …/articles/:id/experiments` |
| `createExperimentForArticle(articleId, body)` | `POST …/articles/:id/experiments` |
| `getExperimentForArticle(articleId, experimentId)` | `GET …/articles/:id/experiments/:eid` |
| `patchExperimentForArticle(articleId, experimentId, body)` | `PATCH` — stats, `action: pause/resume/conclude/cancel`, `apply_winner` |

### Deliveries
| Method | Description |
|---|---|
| `listDeliveries(query?)` | List delivery attempts |
| `getDelivery(deliveryId)` | Get a single delivery |
| `retryDelivery(deliveryId)` | Retry a failed delivery |

### Refresh Queue
| Method | Description |
|---|---|
| `listRefreshQueue(query?)` | List refresh queue items (filter: status, all_statuses) |
| `enqueueRefresh(body?)` | Enqueue stale articles or specific article IDs |
| `processNextRefresh()` | Pop and process the next highest-priority refresh item |

### Analytics & Performance
| Method | Description |
|---|---|
| `ingestEvents(events)` | Ingest client-side analytics events |
| `listEvents(query?)` | List ingested events |
| `getEvent(eventId)` | Fetch a single analytics event |
| `listArticlePerformance(query?)` | List article performance rows |
| `syncArticlePerformance(rows)` | Push performance rows from an external source |

### Logs & Audit
| Method | Description |
|---|---|
| `listAuditLog(query?)` | List audit entries; optional `action`, `entity_type`, pagination |
| `listPublishLogs(query?)` | List publish log events |
| `listGenerationJobs(query?)` | List generation jobs |
| `getGenerationJob(jobId)` | Get a single generation job |

### Dashboard
| Method | Description |
|---|---|
| `getGaps()` | Get keyword/content gap analysis |
| `getDashboardSummary()` | Get app-level stats summary |
| `getDashboard()` | Alias for getGaps() |

### IndexNow
| Method | Description |
|---|---|
| `submitIndexNow(body)` | Submit published URLs to IndexNow |

---

## Webhook Verification

On the base app side, verify incoming SCP webhooks:

```ts
import { verifySCPWebhook } from '@authority-os/seo-control-plane-adapter'

export async function POST(req: Request) {
  const rawBody = await req.text()
  const sig = req.headers.get('X-SCP-Signature') ?? ''
  const valid = await verifySCPWebhook(rawBody, sig, process.env.SCP_WEBHOOK_SECRET!)
  if (!valid) return new Response('Unauthorized', { status: 401 })
  // process payload...
}
```

---

## Environment Variables

| Variable | Description |
|---|---|
| `SCP_BASE_URL` | Full URL of the SEO Control Plane deployment |
| `SCP_APP_ID` | UUID of your registered app (`scp_apps.id`) |
| `SCP_API_KEY` | API key for authenticating requests |
| `SCP_REGISTER_SECRET` | Server-only secret for `registerSeoControlPlaneApp` / `POST /api/apps/register` |
| `SCP_WEBHOOK_SECRET` | HMAC secret for verifying incoming webhooks |
