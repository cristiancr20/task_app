import type { Metadata } from 'next'
import Link from 'next/link'

import { DEFAULT_OLLAMA_MODEL } from '@/lib/ollama'
import { getConfig } from '@/lib/store'

import { ContextFolderForm } from './context-folder-form'
import { ProviderForm } from './provider-form'

// The config is read from disk on every render and changes while the app runs,
// so this page is never prerendered.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Ajustes',
}

export default function SettingsPage() {
  const { contextRoot, recentFolders, provider, ollamaModel, claudeApiKey } = getConfig()

  return (
    <div className="flex flex-1 justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="w-full max-w-2xl px-6 py-12 sm:px-10">
        <header className="mb-10 flex flex-col gap-2">
          <Link
            href="/"
            className="text-sm text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            ← Volver al explorador
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Ajustes
          </h1>
        </header>

        <div className="flex flex-col gap-12">
          <ContextFolderForm contextRoot={contextRoot} recentFolders={recentFolders} />

          {/* The stored key stays on the server: the form only learns it exists. */}
          <ProviderForm
            provider={provider}
            ollamaModel={ollamaModel}
            hasClaudeApiKey={claudeApiKey.trim() !== ''}
            defaultModel={DEFAULT_OLLAMA_MODEL}
          />
        </div>
      </main>
    </div>
  )
}
