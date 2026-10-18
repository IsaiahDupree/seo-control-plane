/**
 * IndexNow — https://www.indexnow.org/documentation
 * Submits URL list to participating search engines via the shared API.
 */
export type IndexNowSubmitParams = {
  host: string
  key: string
  keyLocation?: string
  urlList: string[]
}

export async function submitUrlsToIndexNow(
  params: IndexNowSubmitParams
): Promise<{ ok: boolean; httpStatus: number; responseText: string }> {
  const body: Record<string, unknown> = {
    host: params.host,
    key: params.key,
    urlList: params.urlList,
  }
  if (params.keyLocation) {
    body.keyLocation = params.keyLocation
  }

  const res = await fetch('https://api.indexnow.org/IndexNow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  })

  const responseText = await res.text().catch(() => '')
  const ok = res.status === 200 || res.status === 202
  return { ok, httpStatus: res.status, responseText }
}

/** Extract hostname for IndexNow `host` field (no scheme, no path). */
export function hostFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

/** Values read from `scp_apps.metadata` for IndexNow. */
export type IndexNowAppMetadata = {
  key?: string
  keyLocation?: string
  /** When set, used as IndexNow `host` if hostname cannot be parsed from URLs. */
  hostOverride?: string
  /** When true, `POST /content/publish` may submit the canonical URL automatically. */
  onPublish: boolean
}

export function parseIndexNowFromMetadata(metadata: unknown): IndexNowAppMetadata {
  const meta =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : {}
  return {
    key: typeof meta.indexnow_key === 'string' ? meta.indexnow_key : undefined,
    keyLocation:
      typeof meta.indexnow_key_location === 'string' ? meta.indexnow_key_location : undefined,
    hostOverride: typeof meta.indexnow_host === 'string' ? meta.indexnow_host : undefined,
    onPublish: meta.indexnow_on_publish === true,
  }
}

/**
 * Canonical public URL for an article: prefers `published_url`, else `{base_url}/blog/{slug}`.
 * Matches internal-links convention (`lib/internal-links.ts`).
 */
export function resolveCanonicalArticleUrl(options: {
  publishedUrl?: string | null
  baseUrl?: string | null
  slug: string
}): string | null {
  if (options.publishedUrl) return options.publishedUrl
  const base = options.baseUrl?.replace(/\/$/, '') ?? ''
  if (!base) return null
  return `${base}/blog/${options.slug}`
}

export function resolveIndexNowHost(firstUrl: string, hostOverride?: string | null): string | null {
  const o = hostOverride?.trim()
  if (o) return o
  return hostFromUrl(firstUrl)
}
