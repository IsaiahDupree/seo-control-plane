import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'

export type LLMProvider = 'openai' | 'anthropic'
export type LLMModel =
  | 'gpt-4o'
  | 'gpt-4o-mini'
  | 'claude-3-5-sonnet-20241022'
  | 'claude-3-5-haiku-20241022'

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LLMResponse {
  text: string
  input_tokens: number
  output_tokens: number
  model: string
  provider: LLMProvider
  cost_usd: number
}

const COST_PER_1K: Record<string, { input: number; output: number }> = {
  'gpt-4o':                    { input: 0.0025, output: 0.01 },
  'gpt-4o-mini':               { input: 0.00015, output: 0.0006 },
  'claude-3-5-sonnet-20241022':{ input: 0.003, output: 0.015 },
  'claude-3-5-haiku-20241022': { input: 0.0008, output: 0.004 },
}

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const rates = COST_PER_1K[model] ?? { input: 0.003, output: 0.015 }
  return (inputTokens / 1000) * rates.input + (outputTokens / 1000) * rates.output
}

export async function callLLM(
  messages: LLMMessage[],
  model: LLMModel = 'gpt-4o',
  maxTokens = 4096
): Promise<LLMResponse> {
  if (model.startsWith('gpt-')) {
    return callOpenAI(messages, model, maxTokens)
  }
  if (model.startsWith('claude-')) {
    return callAnthropic(messages, model, maxTokens)
  }
  throw new Error(`Unknown model: ${model}`)
}

async function callOpenAI(
  messages: LLMMessage[],
  model: string,
  maxTokens: number
): Promise<LLMResponse> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const res = await client.chat.completions.create({
    model,
    messages,
    max_tokens: maxTokens,
  })
  const inputTokens = res.usage?.prompt_tokens ?? 0
  const outputTokens = res.usage?.completion_tokens ?? 0
  return {
    text: res.choices[0]?.message?.content ?? '',
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    model,
    provider: 'openai',
    cost_usd: estimateCost(model, inputTokens, outputTokens),
  }
}

async function callAnthropic(
  messages: LLMMessage[],
  model: string,
  maxTokens: number
): Promise<LLMResponse> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const systemMsg = messages.find((m) => m.role === 'system')?.content ?? ''
  const userMsgs = messages.filter((m) => m.role !== 'system').map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }))
  const res = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: systemMsg,
    messages: userMsgs,
  })
  const inputTokens = res.usage.input_tokens
  const outputTokens = res.usage.output_tokens
  const text = res.content.filter((b) => b.type === 'text').map((b) => (b as { type: 'text'; text: string }).text).join('')
  return {
    text,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    model,
    provider: 'anthropic',
    cost_usd: estimateCost(model, inputTokens, outputTokens),
  }
}

export function selectModel(contentType: string): LLMModel {
  switch (contentType) {
    case 'pillar':
    case 'comparison':
    case 'case_study':
      return 'gpt-4o'
    case 'faq':
    case 'cluster':
      return 'gpt-4o-mini'
    default:
      return 'gpt-4o'
  }
}
