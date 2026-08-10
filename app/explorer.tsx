'use client'

import { useEffect, useState } from 'react'

import { FileList } from './file-list'
import { FolderTree } from './folder-tree'
import { useFolderListings } from './use-folder-listings'

type Props = {
  /** Absolute path of the configured context folder, for the tree's root row. */
  contextRoot: string
}

/**
 * The two panels of the explorer: the folder tree on the left and the `.md`
 * files of the selected folder in the centre.
 *
 * Folders are listed from the browser through `/api/browse` rather than on the
 * server, so expanding a node costs one request instead of a re-render of the
 * whole page, and a folder that disappears from disk fails in place with a
 * «Reintentar» instead of breaking the route.
 */
export function Explorer({ contextRoot }: Props) {
  const { states, open, reload } = useFolderListings()
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(['']))
  const [selected, setSelected] = useState('')
  const [selectedFile, setSelectedFile] = useState<string | null>(null)

  // The root starts selected and expanded, so the first paint already shows its
  // files. `open` skips folders that have been asked for, so this runs once.
  useEffect(() => {
    open('')
  }, [open])

  function toggleFolder(relPath: string) {
    open(relPath)
    setExpanded((prev) => {
      const next = new Set(prev)
      if (!next.delete(relPath)) next.add(relPath)
      return next
    })
  }

  function selectFolder(relPath: string) {
    open(relPath)
    setSelected(relPath)
    setSelectedFile(null)
    // Selecting reveals what is inside; collapsing is what the chevron is for.
    setExpanded((prev) => (prev.has(relPath) ? prev : new Set(prev).add(relPath)))
  }

  const rootLabel = folderName(contextRoot)

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-72 shrink-0 flex-col border-r border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="border-b border-zinc-200 px-4 py-3 text-sm font-medium text-zinc-900 dark:border-zinc-800 dark:text-zinc-100">
          Carpetas
        </h2>
        <nav aria-label="Carpetas" className="min-h-0 flex-1 overflow-y-auto p-2">
          <FolderTree
            rootName={rootLabel}
            api={{
              states,
              expanded,
              selected,
              onToggle: toggleFolder,
              onSelect: selectFolder,
              onRetry: reload,
            }}
          />
        </nav>
      </aside>

      <section className="flex min-h-0 flex-1 flex-col bg-white dark:bg-black">
        <FileList
          state={states[selected]}
          breadcrumb={breadcrumb(rootLabel, selected)}
          selectedFile={selectedFile}
          onSelectFile={setSelectedFile}
          onRetry={() => reload(selected)}
        />
      </section>
    </div>
  )
}

/** The last segment of an absolute path — the context folder's own name. */
function folderName(absPath: string): string {
  const segments = absPath.replace(/[\\/]+$/, '').split(/[\\/]/)
  return segments[segments.length - 1] || absPath
}

function breadcrumb(rootLabel: string, relPath: string): string {
  return [rootLabel, ...(relPath ? relPath.split('/') : [])].join(' / ')
}
