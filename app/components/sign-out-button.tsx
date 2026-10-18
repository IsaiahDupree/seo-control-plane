export function SignOutButton() {
  return (
    <form action="/logout" method="post">
      <button
        type="submit"
        className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
      >
        Sign out
      </button>
    </form>
  )
}
