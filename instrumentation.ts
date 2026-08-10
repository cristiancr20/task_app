export async function register() {
  // node:fs is unavailable on the edge runtime, so only touch the disk there.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const { ensureDataDir } = await import('./lib/data-dir')
  ensureDataDir()
}
