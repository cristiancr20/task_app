import type { Metadata } from 'next'
import Link from 'next/link'

import { getConfig } from '@/lib/store'

import { Explorer } from './explorer'

// The context folder is read from disk on every render and changes while the
// app runs, so this page is never prerendered.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Explorador',
}

export default function Home() {
  const { contextRoot: root, linearApiKey, lastProjectId } = getConfig()
  const contextRoot = root?.trim()

  if (!contextRoot) return <NoContextRoot />

  // A definite height (rather than `flex-1` over a content-sized body) is what
  // lets the tree and the file list scroll independently instead of growing the
  // page.
  return (
    <div className="flex h-dvh flex-col bg-white font-sans dark:bg-black">
      <header className="flex items-center justify-between gap-4 border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
        <div className="min-w-0">
          <h1 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Explorador</h1>
          <p
            className="truncate font-mono text-xs text-zinc-500 dark:text-zinc-400"
            title={contextRoot}
          >
            {contextRoot}
          </p>
        </div>
        <Link
          href="/settings"
          className="shrink-0 rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          Ajustes
        </Link>
      </header>

      {/* The stored Linear key stays on the server: the push panel only learns
          whether there is one, so it can say why it cannot create anything. */}
      <Explorer
        contextRoot={contextRoot}
        hasLinearApiKey={linearApiKey.trim() !== ''}
        lastProjectId={lastProjectId}
      />
    </div>
  )
}

/** Nothing can be listed without a root, so the page is just the way to set one. */
function NoContextRoot() {
  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-6 py-16 font-sans dark:bg-black">
      <div className="flex max-w-md flex-col items-center gap-4 rounded-lg border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-950">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          Elige una carpeta de contexto
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Para explorar tus transcripciones, indica la carpeta donde guardas los archivos{' '}
          <code className="rounded bg-black/[.06] px-1.5 py-0.5 font-mono text-[0.9em] dark:bg-white/[.08]">
            .md
          </code>
          .
        </p>
        <Link
          href="/settings"
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Ir a ajustes
        </Link>
      </div>
    </div>
  )
}
