// F-CP-016: Context completeness score
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'

type RouteContext = { params: Promise<{ appId: string }> }

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const admin = createAdminClient()

  const [featuresRes, personasRes, ctasRes, restrictionsRes, publishingRes, keywordsRes] =
    await Promise.all([
      admin.from('scp_app_features').select('tagline, one_liner, what_it_does, differentiators, pricing_tiers').eq('app_id', appId).maybeSingle(),
      admin.from('scp_app_personas').select('id', { count: 'exact', head: true }).eq('app_id', appId),
      admin.from('scp_app_ctas').select('id', { count: 'exact', head: true }).eq('app_id', appId).eq('is_active', true),
      admin.from('scp_app_restrictions').select('id').eq('app_id', appId).maybeSingle(),
      admin.from('scp_app_publishing').select('id').eq('app_id', appId).maybeSingle(),
      admin.from('scp_keywords').select('id', { count: 'exact', head: true }).eq('app_id', appId).eq('is_seed', true),
    ])

  const product = featuresRes.data
  const personaCount = personasRes.count ?? 0
  const ctaCount = ctasRes.count ?? 0
  const hasRestrictions = !!restrictionsRes.data
  const hasPublishing = !!publishingRes.data
  const seedKeywordCount = keywordsRes.count ?? 0

  // Score breakdown per F-CP-016
  const breakdown = {
    product_summary: {
      max: 20,
      score: product
        ? Math.min(
            20,
            (product.tagline ? 5 : 0) +
              (product.one_liner ? 5 : 0) +
              (product.what_it_does ? 5 : 0) +
              ((product.differentiators as string[] | null)?.length ? 5 : 0)
          )
        : 0,
      filled: !!product,
    },
    personas: {
      max: 20,
      score: personaCount >= 3 ? 20 : personaCount >= 1 ? 10 : 0,
      count: personaCount,
    },
    ctas: {
      max: 20,
      score: ctaCount >= 3 ? 20 : ctaCount >= 1 ? 10 : 0,
      count: ctaCount,
    },
    restrictions: {
      max: 20,
      score: hasRestrictions ? 20 : 0,
      filled: hasRestrictions,
    },
    publishing_window: {
      max: 10,
      score: hasPublishing ? 10 : 0,
      filled: hasPublishing,
    },
    keyword_seeds: {
      max: 10,
      score: seedKeywordCount >= 10 ? 10 : seedKeywordCount >= 5 ? 7 : seedKeywordCount >= 1 ? 4 : 0,
      count: seedKeywordCount,
    },
  }

  const totalScore = Object.values(breakdown).reduce((sum, b) => sum + b.score, 0)
  const maxScore = Object.values(breakdown).reduce((sum, b) => sum + b.max, 0)

  const warnings: string[] = []
  if (totalScore < 60) {
    warnings.push('Context score below 60 — generation is blocked until minimum context is provided.')
  }
  if (!product) warnings.push('Product summary missing (POST /context/product)')
  if (personaCount === 0) warnings.push('No personas defined (POST /context/personas)')
  if (ctaCount === 0) warnings.push('No CTAs defined (POST /context/ctas)')
  if (seedKeywordCount === 0) warnings.push('No seed keywords added (POST /keywords/seeds)')

  return NextResponse.json({
    score: totalScore,
    max: maxScore,
    pct: Math.round((totalScore / maxScore) * 100),
    generation_blocked: totalScore < 60,
    breakdown,
    warnings,
  })
}
