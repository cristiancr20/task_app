import type { Metadata } from 'next'
import Link from 'next/link'

import { DEFAULT_OLLAMA_MODEL } from '@/lib/ollama'
import { getConfig } from '@/lib/store'
import { getTheme } from '@/lib/theme-server'

import { ThemeToggle } from '../theme-toggle'
import { ContextFolderForm } from './context-folder-form'
import { LinearForm } from './linear-form'
import { ProviderForm } from './provider-form'

// The config is read from disk on every render and changes while the app runs,
// so this page is never prerendered.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Ajustes',
}

export default async function SettingsPage() {
  const { contextRoot, recentFolders, provider, ollamaModel, claudeApiKey, linearApiKey } =
    getConfig()
  const theme = await getTheme()

  return (
    <div className="flex flex-1 justify-center bg-bg font-sans">
      <main className="w-full max-w-2xl px-6 py-12 sm:px-10">
        <header className="mb-10 flex flex-col gap-2">
          <Link
            href="/"
            className="text-sm text-muted hover:text-content"
          >
            ← Volver al explorador
          </Link>
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-2xl font-semibold tracking-tight text-content">
              Ajustes
            </h1>
            <ThemeToggle current={theme} />
          </div>
        </header>

        {/* One card per setting, on the same ground as the explorer's panels.
            Run together on a bare page, the three forms read as one long form
            with headings; boxed, each is a thing you can finish. */}
        <div className="flex flex-col gap-4">
          <section className="rounded-xl border border-line bg-surface p-6 shadow-panel">
            <ContextFolderForm contextRoot={contextRoot} recentFolders={recentFolders} />
          </section>

          {/* The stored key stays on the server: the form only learns it exists. */}
          <section className="rounded-xl border border-line bg-surface p-6 shadow-panel">
            <ProviderForm
              provider={provider}
              ollamaModel={ollamaModel}
              hasClaudeApiKey={claudeApiKey.trim() !== ''}
              defaultModel={DEFAULT_OLLAMA_MODEL}
            />
          </section>

          <section className="rounded-xl border border-line bg-surface p-6 shadow-panel">
            <LinearForm hasLinearApiKey={linearApiKey.trim() !== ''} />
          </section>
        </div>
      </main>
    </div>
  )
}
