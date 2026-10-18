import { createAdminClient } from '@/lib/supabase'

export type VariantType =
  | 'title'
  | 'meta_description'
  | 'cta_text'
  | 'cta_position'
  | 'h2_heading'
  | 'intro_paragraph'

export interface ExperimentResult {
  winner: 'control' | 'variant' | null
  significance_pct: number | null
  control_cr: number
  variant_cr: number
  delta_pct: number
}

/**
 * Compute a simple two-proportion z-test to determine statistical significance.
 * Returns significance as a percentage (0-100).
 */
export function computeSignificance(
  controlConversions: number,
  controlSessions: number,
  variantConversions: number,
  variantSessions: number
): number {
  if (controlSessions === 0 || variantSessions === 0) return 0

  const p1 = controlConversions / controlSessions
  const p2 = variantConversions / variantSessions
  const pPool = (controlConversions + variantConversions) / (controlSessions + variantSessions)
  const se = Math.sqrt(pPool * (1 - pPool) * (1 / controlSessions + 1 / variantSessions))

  if (se === 0) return 0

  const z = Math.abs(p2 - p1) / se
  // Approximate normal CDF for one-sided significance
  const significance = (1 - normalCdf(z)) * 100
  return Math.max(0, Math.min(100, 100 - significance))
}

function normalCdf(z: number): number {
  // Abramowitz & Stegun approximation
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911
  const sign = z < 0 ? -1 : 1
  const x = Math.abs(z) / Math.sqrt(2)
  const t = 1 / (1 + p * x)
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x)
  return 0.5 * (1 + sign * y)
}

/**
 * Determine winner and compute stats for an experiment.
 */
export function evaluateExperiment(exp: {
  control_conversions: number
  variant_conversions: number
  control_sessions: number
  variant_sessions: number
  significance_pct?: number | null
}): ExperimentResult {
  const sig = computeSignificance(
    exp.control_conversions,
    exp.control_sessions,
    exp.variant_conversions,
    exp.variant_sessions
  )

  const controlCr = exp.control_sessions > 0 ? exp.control_conversions / exp.control_sessions : 0
  const variantCr = exp.variant_sessions > 0 ? exp.variant_conversions / exp.variant_sessions : 0
  const deltaPct = controlCr > 0 ? ((variantCr - controlCr) / controlCr) * 100 : 0

  let winner: 'control' | 'variant' | null = null
  if (sig >= 95) {
    winner = variantCr >= controlCr ? 'variant' : 'control'
  }

  return { winner, significance_pct: sig, control_cr: controlCr, variant_cr: variantCr, delta_pct: deltaPct }
}

/**
 * Conclude an experiment: record winner, apply winning variant to article if applicable.
 */
export async function concludeExperiment(
  experimentId: string,
  appId: string,
  applyWinner = false
): Promise<{ ok: boolean; winner: 'control' | 'variant' | null; error?: string }> {
  const db = createAdminClient()

  const { data: exp, error } = await db
    .from('scp_experiments')
    .select('*')
    .eq('id', experimentId)
    .eq('app_id', appId)
    .single()

  if (error || !exp) return { ok: false, winner: null, error: 'Experiment not found' }
  if (exp.status === 'concluded') return { ok: true, winner: exp.winner as 'control' | 'variant' | null }

  const result = evaluateExperiment({
    control_conversions: exp.control_conversions as number,
    variant_conversions: exp.variant_conversions as number,
    control_sessions: exp.control_sessions as number,
    variant_sessions: exp.variant_sessions as number,
  })

  await db
    .from('scp_experiments')
    .update({
      status: 'concluded',
      winner: result.winner,
      significance_pct: result.significance_pct,
      concluded_at: new Date().toISOString(),
    })
    .eq('id', experimentId)

  // Optionally apply winning value to article
  if (applyWinner && result.winner && exp.article_id) {
    const winningValue = result.winner === 'variant' ? exp.variant_value : exp.control_value
    const variantType = exp.variant_type as VariantType

    const columnMap: Partial<Record<VariantType, string>> = {
      title: 'title',
      meta_description: 'meta_description',
    }
    const col = columnMap[variantType]
    if (col) {
      await db
        .from('scp_articles')
        .update({ [col]: winningValue, updated_at: new Date().toISOString() })
        .eq('id', exp.article_id as string)
    }
  }

  return { ok: true, winner: result.winner }
}
