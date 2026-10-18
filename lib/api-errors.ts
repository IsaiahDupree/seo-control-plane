import { NextResponse } from 'next/server'

export function jsonError(
  status: number,
  code: string,
  message: string,
  extras?: Record<string, unknown>
) {
  return NextResponse.json(
    { error: { code, message, ...extras } },
    { status }
  )
}
