export type AppStatus = 'active' | 'suspended' | 'pending'
export type ContentType = 'pillar' | 'cluster' | 'comparison' | 'alternatives' | 'faq' | 'guide' | 'case_study'
export type ArticleStatus = 'brief_pending' | 'generating' | 'qa_pending' | 'qa_review' | 'approved' | 'delivered' | 'published' | 'archived'
export type QAOutcome = 'approved' | 'rejected' | 'needs_revision'
export type DeliveryStatus = 'pending' | 'delivered' | 'failed' | 'confirmed'
export type LLMProvider = 'openai' | 'anthropic' | 'google'
export type LLMModel = 'gpt-4o' | 'gpt-4o-mini' | 'claude-3-5-sonnet' | 'claude-3-5-haiku' | 'gemini-1.5-pro'

export interface RegisteredApp {
  id: string
  name: string
  domain: string
  vercel_project_id: string | null
  table_prefix: string
  webhook_url: string
  webhook_secret: string
  status: AppStatus
  context: AppContext
  plan: string
  created_at: string
  updated_at: string
}

export interface AppContext {
  description: string
  target_personas: string[]
  content_restrictions: string[]
  brand_voice?: string
  features?: string[]
  pricing_tiers?: string[]
  prohibited_phrases?: string[]
}

export interface ContentBrief {
  id: string
  app_id: string
  focus_keyword: string
  secondary_keywords: string[]
  content_type: ContentType
  cluster_name: string
  target_word_count: number
  target_persona: string
  competitor_urls: string[]
  serp_analysis: SERPAnalysis | null
  tone_notes: string
  cta_guidance: string
  status: 'pending' | 'assigned' | 'generating' | 'complete'
  created_at: string
}

export interface SERPAnalysis {
  top_results: { url: string; title: string; word_count: number; h2s: string[] }[]
  paa_questions: string[]
  average_word_count: number
  information_gaps: string[]
  difficulty_score: number
}

export interface GeneratedArticle {
  id: string
  app_id: string
  brief_id: string
  draft_id: string
  slug: string
  title: string
  content_html: string
  content_markdown: string
  meta_title: string
  meta_description: string
  og_image_url: string | null
  canonical_url: string
  focus_keyword: string
  secondary_keywords: string[]
  content_type: ContentType
  cluster_name: string
  word_count: number
  reading_time_minutes: number
  author: ArticleAuthor
  schema_json: Record<string, unknown>
  table_of_contents: TOCItem[]
  cta_blocks: CTABlock[]
  internal_links: InternalLink[]
  tags: string[]
  status: ArticleStatus
  qa_score: number | null
  confidence_score: number | null
  is_stub: boolean
  is_visible: boolean
  published_at: string | null
  delivery_version: number
  created_at: string
}

export interface ArticleAuthor {
  name: string
  bio: string
  avatar_url?: string
  linkedin_url?: string
  credential_signal: string
}

export interface TOCItem {
  level: 2 | 3
  text: string
  anchor: string
  children?: TOCItem[]
}

export interface CTABlock {
  id: string
  position: 'top' | 'middle' | 'bottom' | 'conclusion'
  label: string
  url: string
  benefit_statement: string
  button_text: string
  style: 'primary' | 'secondary' | 'ghost'
  utm_params: Record<string, string>
  rendered_html: string
}

export interface InternalLink {
  from_article_id: string
  to_article_id: string | null
  to_slug: string
  to_title: string
  anchor_text: string
  position_in_article: 'top_third' | 'middle_third' | 'bottom_third'
  inserted_by: 'generation' | 'refresh' | 'human'
  semantic_score: number
}

export interface DeliveryPayload {
  delivery_id: string
  app_id: string
  article_id: string
  version: number
  slug: string
  title: string
  content_html: string
  content_markdown: string
  meta_title: string
  meta_description: string
  og_image_url: string | null
  canonical_url: string
  focus_keyword: string
  secondary_keywords: string[]
  content_type: ContentType
  cluster_name: string
  word_count: number
  reading_time_minutes: number
  author: ArticleAuthor
  schema_json: Record<string, unknown>
  table_of_contents: TOCItem[]
  cta_blocks: CTABlock[]
  internal_links: InternalLink[]
  tags: string[]
  is_stub: boolean
  is_visible: boolean
  published_at: string | null
  quality_score: number
  confidence_score: number
  diff_summary?: string
}

export interface QAReport {
  id: string
  article_id: string
  overall_score: number
  quality_score: number
  seo_score: number
  readability_score: number
  checks_passed: string[]
  checks_failed: string[]
  blocking_issues: string[]
  warnings: string[]
  outcome: QAOutcome
  created_at: string
}

export interface AnalyticsEvent {
  event_id: string
  app_id: string
  article_id: string
  session_id: string
  user_id?: string
  event_type: string
  event_data: Record<string, unknown>
  occurred_at: string
  sdk_version: string
}

export interface ContentRequestParams {
  count: number
  content_types?: ContentType[]
  cluster_preferences?: string[]
  urgency?: 'standard' | 'expedited'
  custom_keywords?: string[]
}
