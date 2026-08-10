'use client'

import { useCallback, useEffect, useState } from 'react'

import { FileList } from './file-list'
import { FolderTree } from './folder-tree'
import { PushPanel } from './push-panel'
import { TaskTable } from './task-table'
import { TranscriptPreview } from './transcript-preview'
import { useFolderListings } from './use-folder-listings'
import { usePushOptions } from './use-push-options'
import { createdIssuesOf, parentIssueOf, usePushRun } from './use-push-run'
import { usePushTarget } from './use-push-target'
import { useTaskDrafts } from './use-task-drafts'
import { useTranscript } from './use-transcript'

type Props = {
  /** Absolute path of the configured context folder, for the tree's root row. */
  contextRoot: string
  /** Whether a Linear key is stored. The key itself never reaches the browser. */
  hasLinearApiKey: boolean
  /** The project pushed to last, so the panel starts on it. */
  lastProjectId: string | null
}

/**
 * The three panels of the explorer: the folder tree on the left, the `.md`
 * files of the selected folder in the centre, and the selected transcript on
 * the right — with the task table underneath, across the full width, once a
 * file is selected.
 *
 * Folders are listed from the browser through `/api/browse` rather than on the
 * server, so expanding a node costs one request instead of a re-render of the
 * whole page, and a folder that disappears from disk fails in place with a
 * «Reintentar» instead of breaking the route.
 *
 * The drafts live here rather than inside the table because they outlive the
 * selection: `useTaskDrafts` keys them by path, so browsing to another note and
 * back shows the edits again.
 */
export function Explorer({ contextRoot, hasLinearApiKey, lastProjectId }: Props) {
  const { states, open, reload } = useFolderListings()
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(['']))
  const [selected, setSelected] = useState('')
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const {
    state: transcript,
    reload: reloadTranscript,
    refresh: refreshTranscript,
  } = useTranscript(selectedFile)
  const drafts = useTaskDrafts(selectedFile)
  // The destination is workspace-wide, so it is loaded once and outlives every
  // selection; the parent options belong to one note and are keyed by path.
  const target = usePushTarget({ hasLinearApiKey, lastProjectId })
  const pushOptions = usePushOptions(selectedFile)

  // The route writes the created issues to the history, so the already-processed
  // notice of the note is out of date the moment a run ends — but only for the
  // note that ran: a push finishing after the user moved on must not re-read
  // somebody else's file.
  const onPushed = useCallback(
    (path: string) => {
      if (path === selectedFile) refreshTranscript()
    },
    [refreshTranscript, selectedFile],
  )
  const run = usePushRun(selectedFile, onPushed)

  // The parent issue stands for the meeting, so its title starts as the note's
  // own — and only until the user types, which is what the null means.
  const meetingTitle = transcript?.status === 'ready' ? transcript.transcript.meta.title : ''
  const parentTitle = pushOptions.options.parentTitle ?? meetingTitle

  const rows = drafts.state?.rows ?? []
  const results = run.state.rows
  // What the button would send: checked rows Linear does not already have. This
  // is what makes a retry a retry — a created row is out of the request, not
  // merely skipped by the server.
  const pending = rows.filter((row) => row.include && results[row.id]?.state !== 'created')
  const failed = rows.filter((row) => row.include && results[row.id]?.state === 'failed').length
  const created = rows.filter((row) => results[row.id]?.state === 'created').length
  const parentIssue = parentIssueOf(run.state)
  const createdIssues = createdIssuesOf(run.state)

  function startPush() {
    run.push({
      teamId: target.teamId,
      projectId: target.projectId || null,
      // The parent is created once per note: a retry hangs its tasks from the
      // one that already exists instead of filing a second copy of the meeting.
      parentTitle:
        pushOptions.options.createParent && !parentIssue ? parentTitle.trim() || null : null,
      parentId: pushOptions.options.createParent ? (parentIssue?.id ?? null) : null,
      tasks: pending.map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description,
        priority: row.priority,
        mentioned: row.mentioned,
        evidence: row.evidence,
      })),
    })
  }

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
    <div className="flex min-h-0 flex-1 flex-col">
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

        <section className="flex w-96 shrink-0 min-h-0 flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-black">
          <FileList
            state={states[selected]}
            breadcrumb={breadcrumb(rootLabel, selected)}
            selectedFile={selectedFile}
            onSelectFile={setSelectedFile}
            onRetry={() => reload(selected)}
          />
        </section>

        <section
          aria-label="Transcripción"
          className="flex min-h-0 min-w-0 flex-1 flex-col bg-white dark:bg-black"
        >
          <TranscriptPreview state={transcript} onRetry={reloadTranscript} />
        </section>
      </div>

      {/* The table is the widest thing on the page, so it gets the full width
          under the three panels — and only exists once there is a file to
          extract from. `h-[38dvh]` keeps the height definite, which is what
          lets both halves scroll on their own. */}
      {selectedFile ? (
        <>
          <section
            aria-label="Tareas"
            className="flex h-[38dvh] shrink-0 border-t border-zinc-200 bg-white dark:border-zinc-800 dark:bg-black"
          >
            <TaskTable
              state={drafts.state}
              results={results}
              busy={run.state.status === 'running'}
              onGenerate={drafts.generate}
              onConfirmGenerate={drafts.confirmGenerate}
              onCancelGenerate={drafts.cancelGenerate}
              onUpdateRow={drafts.updateRow}
              onRemoveRow={drafts.removeRow}
              onAddRow={drafts.addRow}
            />
          </section>

          {/* The destination sits under the table it applies to: what is
              checked above is what the button below creates. */}
          <section
            aria-label="Envío a Linear"
            className="shrink-0 border-t border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950"
          >
            <PushPanel
              target={target}
              parent={{
                create: pushOptions.options.createParent,
                title: parentTitle,
                onToggle: pushOptions.setCreateParent,
                onTitleChange: pushOptions.setParentTitle,
              }}
              push={{
                status: run.state.status,
                pending: pending.length,
                failed,
                created,
                issues: createdIssues,
                parentIssue,
                progress: run.state.progress,
                error: run.state.error,
                onPush: startPush,
              }}
            />
          </section>
        </>
      ) : null}
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
