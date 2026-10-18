import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Not found',
}

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#0a0a0b] px-6">
      <p className="text-xs uppercase tracking-widest text-zinc-500">Authority OS</p>
      <h1 className="mt-4 text-2xl font-semibold text-zinc-100">Page not found</h1>
      <p className="mt-2 max-w-sm text-center text-sm text-zinc-500">
        This URL is not part of the SEO Control Plane.
      </p>
      <Link
        href="/"
        className="mt-10 rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:border-zinc-500 hover:text-white"
      >
        Back to overview
      </Link>
    </main>
  )
}
