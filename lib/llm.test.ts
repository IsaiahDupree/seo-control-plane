import { afterEach, describe, expect, it, vi } from 'vitest'

const { mockOpenAICreate, mockAnthropicCreate, MockOpenAI, MockAnthropic } = vi.hoisted(() => {
  const mockOpenAICreate = vi.fn()
  const mockAnthropicCreate = vi.fn()
  class MockOpenAI {
    chat = {
      completions: {
        create: mockOpenAICreate,
      },
    }
  }
  class MockAnthropic {
    messages = {
      create: mockAnthropicCreate,
    }
  }
  return { mockOpenAICreate, mockAnthropicCreate, MockOpenAI, MockAnthropic }
})

vi.mock('openai', () => ({
  default: MockOpenAI,
}))

vi.mock('@anthropic-ai/sdk', () => ({
  default: MockAnthropic,
}))

import { callLLM, selectModel, type LLMModel } from './llm'

const sampleMessages = [
  { role: 'system' as const, content: 'You are helpful.' },
  { role: 'user' as const, content: 'Say hi.' },
]

describe('selectModel', () => {
  it('uses gpt-4o for pillar, comparison, and case_study', () => {
    expect(selectModel('pillar')).toBe('gpt-4o')
    expect(selectModel('comparison')).toBe('gpt-4o')
    expect(selectModel('case_study')).toBe('gpt-4o')
  })

  it('uses gpt-4o-mini for faq and cluster', () => {
    expect(selectModel('faq')).toBe('gpt-4o-mini')
    expect(selectModel('cluster')).toBe('gpt-4o-mini')
  })

  it('defaults to gpt-4o for other content types', () => {
    expect(selectModel('guide')).toBe('gpt-4o')
    expect(selectModel('alternatives')).toBe('gpt-4o')
    expect(selectModel('')).toBe('gpt-4o')
  })
})

describe('callLLM', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('routes gpt models through OpenAI and maps usage and cost', async () => {
    mockOpenAICreate.mockResolvedValue({
      choices: [{ message: { content: '{"ok":true}' } }],
      usage: { prompt_tokens: 1000, completion_tokens: 500 },
    })

    const out = await callLLM(sampleMessages, 'gpt-4o-mini', 512)

    expect(mockOpenAICreate).toHaveBeenCalledWith({
      model: 'gpt-4o-mini',
      messages: sampleMessages,
      max_tokens: 512,
    })
    expect(mockAnthropicCreate).not.toHaveBeenCalled()
    expect(out).toMatchObject({
      text: '{"ok":true}',
      input_tokens: 1000,
      output_tokens: 500,
      model: 'gpt-4o-mini',
      provider: 'openai',
    })
    expect(out.cost_usd).toBeCloseTo((1000 / 1000) * 0.00015 + (500 / 1000) * 0.0006, 8)
  })

  it('handles missing OpenAI usage as zero tokens', async () => {
    mockOpenAICreate.mockResolvedValue({
      choices: [{ message: { content: 'x' } }],
      usage: undefined,
    })

    const out = await callLLM(sampleMessages, 'gpt-4o')
    expect(out.input_tokens).toBe(0)
    expect(out.output_tokens).toBe(0)
    expect(out.text).toBe('x')
  })

  it('uses default per-1k rates for OpenAI when model id is not in the cost table', async () => {
    mockOpenAICreate.mockResolvedValue({
      choices: [{ message: { content: 'ok' } }],
      usage: { prompt_tokens: 1000, completion_tokens: 500 },
    })

    const out = await callLLM(sampleMessages, 'gpt-unknown-future' as LLMModel, 128)

    expect(mockOpenAICreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-unknown-future', max_tokens: 128 })
    )
    expect(out.cost_usd).toBeCloseTo((1000 / 1000) * 0.003 + (500 / 1000) * 0.015, 8)
  })

  it('returns empty string when OpenAI choice has no message content', async () => {
    mockOpenAICreate.mockResolvedValue({
      choices: [{ message: {} }],
      usage: { prompt_tokens: 0, completion_tokens: 0 },
    })

    const out = await callLLM(sampleMessages, 'gpt-4o')
    expect(out.text).toBe('')
  })

  it('routes claude models through Anthropic with system split', async () => {
    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Hello from Claude.' }],
      usage: { input_tokens: 20, output_tokens: 10 },
    })

    const out = await callLLM(sampleMessages, 'claude-3-5-haiku-20241022', 256)

    expect(mockAnthropicCreate).toHaveBeenCalledWith({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 256,
      system: 'You are helpful.',
      messages: [{ role: 'user', content: 'Say hi.' }],
    })
    expect(mockOpenAICreate).not.toHaveBeenCalled()
    expect(out).toMatchObject({
      text: 'Hello from Claude.',
      input_tokens: 20,
      output_tokens: 10,
      model: 'claude-3-5-haiku-20241022',
      provider: 'anthropic',
    })
  })

  it('passes user/assistant turns to Anthropic and omits system from messages', async () => {
    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Done.' }],
      usage: { input_tokens: 30, output_tokens: 3 },
    })

    const thread = [
      { role: 'system' as const, content: 'Rules.' },
      { role: 'user' as const, content: 'First.' },
      { role: 'assistant' as const, content: 'Reply.' },
      { role: 'user' as const, content: 'Second.' },
    ]

    await callLLM(thread, 'claude-3-5-sonnet-20241022', 900)

    expect(mockAnthropicCreate).toHaveBeenCalledWith({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 900,
      system: 'Rules.',
      messages: [
        { role: 'user', content: 'First.' },
        { role: 'assistant', content: 'Reply.' },
        { role: 'user', content: 'Second.' },
      ],
    })
  })

  it('joins multiple Anthropic text blocks and skips non-text blocks', async () => {
    mockAnthropicCreate.mockResolvedValue({
      content: [
        { type: 'tool_use', id: 'tu_1', name: 'noop', input: {} },
        { type: 'text', text: 'A' },
        { type: 'text', text: 'B' },
      ],
      usage: { input_tokens: 1, output_tokens: 2 },
    })

    const out = await callLLM([{ role: 'user', content: 'x' }], 'claude-3-5-haiku-20241022')

    expect(out.text).toBe('AB')
  })

  it('uses empty system string when no system message for Anthropic', async () => {
    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'y' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    })

    await callLLM([{ role: 'user', content: 'only user' }], 'claude-3-5-haiku-20241022')

    expect(mockAnthropicCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        system: '',
        messages: [{ role: 'user', content: 'only user' }],
      })
    )
  })

  it('throws for unknown model prefix', async () => {
    await expect(callLLM([], 'not-a-real-model' as LLMModel)).rejects.toThrow('Unknown model: not-a-real-model')
  })
})
