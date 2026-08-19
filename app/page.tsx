import type { Metadata } from 'next'
import Link from 'next/link'

import { getConfig } from '@/lib/store'
import type { Theme } from '@/lib/theme'
import { getTheme } from '@/lib/theme-server'

import { Explorer } from './explorer'
import { ThemeToggle } from './theme-toggle'

// The context folder is read from disk on every render and changes while the
// app runs, so this page is never prerendered.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Explorador',
}

export default async function Home() {
  const { contextRoot: root, linearApiKey, lastProjectId } = getConfig()
  const contextRoot = root?.trim()
  const theme = await getTheme()

  if (!contextRoot) return <NoContextRoot theme={theme} />

  // A definite height (rather than `flex-1` over a content-sized body) is what
  // lets the tree and the file list scroll independently instead of growing the
  // page.
  return (
    <div className="flex h-dvh flex-col bg-bg font-sans">
      {/* The bar rides on the ground rather than on a white fill of its own:
          the panels below are the raised things, and a second raised surface
          above them would flatten the page again. */}
      <header className="flex items-center justify-between gap-4 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <AppMark />
          <div className="min-w-0">
            <h1 className="text-sm font-semibold leading-tight text-content">Explorador</h1>
            <p className="truncate font-mono text-xs text-muted" title={contextRoot}>
              {contextRoot}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ThemeToggle current={theme} />
          <Link
            href="/settings"
            className="shrink-0 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium shadow-panel transition-colors hover:bg-surface-2"
          >
            Ajustes
          </Link>
        </div>
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

/**
 * The one piece of brand on the page: the accent, as a solid tile with the
 * transcript-to-task idea in it — lines of text with a tick against them. It
 * also gives the title block a left edge to sit against.
 */
function AppMark() {
  return (
    <span
      aria-hidden="true"
      className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-on-accent shadow-panel"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-4"
      >
        <path d="M5 6h9M5 11h6" />
        <path d="M5 16h5" />
        <path d="m14 16 2.5 2.5L21 14" />
      </svg>
    </span>
  )
}

/**
 * Nothing can be listed without a root, so the page is just the way to set one.
 * It replaces the header, hence its own copy of the theme toggle — otherwise a
 * fresh install has no way to change the theme from the page it lands on.
 */
function NoContextRoot({ theme }: { theme: Theme }) {
  return (
    <div className="flex flex-1 items-center justify-center bg-bg px-6 py-16 font-sans">
      <div className="flex max-w-md flex-col items-center gap-4 rounded-xl border border-line bg-surface p-8 text-center shadow-panel">
        <h1 className="text-lg font-semibold text-content">
          Elige una carpeta de contexto
        </h1>
        <p className="text-sm text-muted">
          Para explorar tus transcripciones, indica la carpeta donde guardas los archivos{' '}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[0.9em]">
            .md
          </code>
          .
        </p>
        <Link
          href="/settings"
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-colors hover:bg-accent-soft"
        >
          Ir a ajustes
        </Link>
        <ThemeToggle current={theme} />
      </div>
    </div>
  )
}
