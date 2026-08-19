import { describe, expect, it } from 'vitest'

import { defaultConfig, getConfig } from '@/lib/store'
import { DEFAULT_OLLAMA_MODEL } from '@/lib/ollama'

describe('defaultConfig', () => {
  it('starts empty with ollama as the provider', () => {
    expect(defaultConfig()).toEqual({
      recentFolders: [],
      contextRoot: null,
      provider: 'ollama',
      ollamaModel: DEFAULT_OLLAMA_MODEL,
      claudeApiKey: '',
      linearApiKey: '',
      lastProjectId: null,
      history: {},
    })
  })

  it('hands out a fresh object each call, so callers cannot mutate the defaults', () => {
    const first = defaultConfig()
    first.recentFolders.push('/tmp/notes')
    expect(defaultConfig().recentFolders).toEqual([])
  })
})

describe('getConfig', () => {
  // Not invoked here: it reads `.data/config.json`, which is local machine
  // state. Importing it is what proves the `@/` alias resolves in tests.
  it('is importable through the @/ alias', () => {
    expect(typeof getConfig).toBe('function')
  })
})
