'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

import type { FileView } from '@/lib/browse-client'
import { decideDuplicates, exclusionKey, scopeKeyOf } from '@/lib/duplicate-check'
import { issueStatesById } from '@/lib/issue-state-summary'
import { ancestorFolders, folderLabel, folderName, folderOfNote } from '@/lib/note-paths'
import { pendingCommitments } from '@/lib/pending-commitments'

import { FileList } from './file-list'
import { FolderTree } from './folder-tree'
import { MeetingInsights } from './meeting-insights'
import { PendingCommitments } from './pending-commitments'
import { PushPanel } from './push-panel'
import { PushedHistory } from './pushed-history'
import { useSearchApi } from './search-provider'
import { SearchResults } from './search-results'
import { TaskTable } from './task-table'
import { TranscriptPreview } from './transcript-preview'
import { useDuplicateCheck } from './use-duplicate-check'
import { useFolderHistory } from './use-folder-history'
import { useFolderIssueStates } from './use-folder-issue-states'
import { useFolderListings } from './use-folder-listings'
import { useIssueStates } from './use-issue-states'
import { usePushOptions } from './use-push-options'
import { createdIssuesOf, parentIssueOf, usePushRun } from './use-push-run'
import { usePushTarget } from './use-push-target'
import { useSplit } from './use-split'
import { useTaskDrafts } from './use-task-drafts'
import { useTranscript } from './use-transcript'

/** A folder that has not been listed yet, as one array rather than a new one per render. */
const NO_FILES: FileView[] = []

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
 *
 * While the header's search field has something in it the centre column shows
 * the results instead of the folder. Only that column changes: the note being
 * read stays on screen throughout, and opening a result moves the selection to
 * its folder so that leaving the search lands somewhere that makes sense.
 */
export function Explorer({ contextRoot, hasLinearApiKey, lastProjectId }: Props) {
  const { states, open, reload, refresh: refreshFolder } = useFolderListings()
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(['']))
  const [selected, setSelected] = useState('')
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  // Session-only: which folder you are in already persists through `selected`,
  // and a remembered-but-invisible panel is a worse first impression than one
  // that simply starts open every time.
  const [sidebarOpen, setSidebarOpen] = useState(true)
  // The field is in the header, outside this component; what it is looking for
  // is drawn here, in the column the folder's files occupy — see `SearchProvider`.
  const search = useSearchApi()
  const split = useSplit(50)
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
  // somebody else's file. Its badge in the list is out of date either way, and
  // that one belongs to the note's own folder, not to the folder on screen.
  const onPushed = useCallback(
    (path: string) => {
      if (path === selectedFile) refreshTranscript()
      refreshFolder(folderOfNote(path))
    },
    [refreshFolder, refreshTranscript, selectedFile],
  )
  const run = usePushRun(selectedFile, onPushed)

  // The parent issue stands for the meeting, so its title starts as the note's
  // own — and only until the user types, which is what the null means.
  const meetingTitle = transcript?.status === 'ready' ? transcript.transcript.meta.title : ''
  // The push history travels with the note, and is reported in the Linear
  // column: what this file already produced belongs next to what it is about
  // to produce, not on top of the text it came from.
  const history = transcript?.status === 'ready' ? transcript.transcript.history : []
  const parentTitle = pushOptions.options.parentTitle ?? meetingTitle

  // What the state report is about. A note with no history has no ids, which is
  // how the hook knows there is nothing to ask — the block is not rendered
  // either way, and no request is made for it.
  const historyIssueIds = useMemo(
    () => history.flatMap((entry) => entry.issues.map((issue) => issue.id)),
    [history],
  )
  const issueStates = useIssueStates({
    relPath: selectedFile,
    issueIds: historyIssueIds,
    hasLinearApiKey,
  })

  // The badges of the list read from one query for the whole folder on screen,
  // not one per row — see `useFolderIssueStates`. It is about the *selected*
  // folder, which is the one `FileList` draws, and not about the note open in
  // the column to its right.
  const folder = states[selected]
  const folderFiles = folder?.status === 'ready' ? folder.listing.files : NO_FILES
  const folderIssueStates = useFolderIssueStates({
    folder: selected,
    files: folderFiles,
    hasLinearApiKey,
  })
  // The same folder's push history, which is where the *other* meetings are:
  // their project, their issues and their dates. It is a local read, so it
  // costs nothing beyond the listing that is already being fetched.
  const folderHistory = useFolderHistory({ folder: selected, files: folderFiles })

  // What previous meetings of the selected project left open. Both halves of it
  // are already on the page — the history above and the states the badges were
  // drawn from — so the panel adds no query of its own: opening a note asks
  // Linear nothing it has not already been asked in this session. Without a key
  // there are no states, and without a project the rule answers nothing, so the
  // panel simply does not appear in either case.
  const knownStates = useMemo(
    () => issueStatesById(Object.values(folderIssueStates).flat()),
    [folderIssueStates],
  )
  // The listing already carries every title of the folder; the pure module
  // falls back to the file name for a note that is not in it.
  const folderTitles = useMemo(
    () => Object.fromEntries(folderFiles.map((file) => [file.relPath, file.title])),
    [folderFiles],
  )
  const previousCommitments = useMemo(
    () =>
      selectedFile
        ? pendingCommitments({
            history: folderHistory,
            states: knownStates,
            notePath: selectedFile,
            projectId: target.projectId || null,
            titles: folderTitles,
          })
        : [],
    [folderHistory, folderTitles, knownStates, selectedFile, target.projectId],
  )

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

  // What the duplicate check is aimed at. Only a chosen project counts: the
  // whole team is a far wider net than the user asked for, and a check against
  // it would report tasks that belong to another piece of work entirely. With
  // no key, no team or no project the check simply has nothing to say.
  const duplicateScope = useMemo(
    () =>
      target.status === 'ready' && target.teamId && target.projectId
        ? { teamId: target.teamId, projectId: target.projectId }
        : null,
    [target.projectId, target.status, target.teamId],
  )
  // Rows this push already created: they are in Linear because they were just
  // put there, so they are the one thing the check must not look at.
  const createdRowIds = useMemo(
    () =>
      new Set(
        Object.entries(results).flatMap(([id, result]) =>
          result.state === 'created' ? [id] : [],
        ),
      ),
    [results],
  )
  const duplicates = useDuplicateCheck({
    relPath: selectedFile,
    scope: duplicateScope,
    rows,
    skipRowIds: createdRowIds,
  })

  // Which rows the app has already unchecked on its own, per destination — see
  // `exclusionKey`. It is the whole of «una sola vez»: the ids stay here after
  // the row is unchecked, so checking it back is a decision the check does not
  // get to overrule, and it is the same memory that tells a re-marked row from
  // one nobody has touched.
  const [autoExcluded, setAutoExcluded] = useState<ReadonlySet<string>>(() => new Set())
  const duplicateScopeKey = scopeKeyOf(duplicateScope)
  const decisions = useMemo(
    () => decideDuplicates(rows, duplicates.matches, duplicateScopeKey, autoExcluded),
    [autoExcluded, duplicateScopeKey, duplicates.matches, rows],
  )

  // Unchecking is a change to the rows, so it belongs in an effect rather than
  // in the render that decided it. It settles in one pass: the rows it names
  // come back unchecked and their keys are remembered, so the next `decisions`
  // has nothing left to exclude.
  // `excludeRows` rather than `drafts`: the hook returns a fresh object every
  // render, and this effect must be about the rows it names, not about React.
  const { excludeRows } = drafts
  const { toExclude } = decisions
  useEffect(() => {
    if (toExclude.length === 0 || !duplicateScopeKey) return
    excludeRows(toExclude)
    setAutoExcluded((previous) => {
      const next = new Set(previous)
      for (const id of toExclude) next.add(exclusionKey(duplicateScopeKey, id))
      return next
    })
  }, [duplicateScopeKey, excludeRows, toExclude])

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
        dueDate: row.dueDate,
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

  /**
   * Open a search result: the note in the transcript column, and the folder it
   * came from selected and revealed in the tree behind the results.
   *
   * A result may name a note in a folder nobody has clicked in this session,
   * so the whole chain of ancestors is listed and expanded rather than just the
   * folder itself — otherwise leaving the search would land on a selection the
   * tree cannot show. The search is *not* closed: the field still holds the
   * query, so the next result is one click away, and emptying it later comes
   * back to this folder with this note still open.
   */
  function openResult(relPath: string) {
    const folder = folderOfNote(relPath)
    const chain = ancestorFolders(folder)

    for (const path of chain) open(path)
    setSelected(folder)
    setSelectedFile(relPath)
    setExpanded((prev) => {
      const next = new Set(prev)
      for (const path of chain) next.add(path)
      return next
    })
  }

  const rootLabel = folderName(contextRoot)

  return (
    // One row of panels, all of them full height, floating on the ground with a
    // gap between them. Nothing stacks vertically any more: the transcript used
    // to lose more than half its height to the table below it, and reading is
    // the step that needs the room.
    <div className="flex min-h-0 flex-1 gap-2 px-3 pb-3">
      {/* Collapsed, the tree becomes a 10-rem-narrower page. On a laptop that
          is the difference between four cramped columns and three comfortable
          ones, so it is a layout control, not a decoration. */}
      {sidebarOpen ? (
        // The one panel that is recessed rather than white: navigation is
        // chrome, and the columns to its right are the content it leads to.
        <aside className="panel w-60 shrink-0 bg-surface-2">
          <div className="panel-head justify-between">
            <h2 className="panel-title">Carpetas</h2>
            <SidebarToggle open onClick={() => setSidebarOpen(false)} />
          </div>
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
      ) : (
        <div className="panel shrink-0 items-center bg-surface-2 px-1.5 py-2">
          <SidebarToggle open={false} onClick={() => setSidebarOpen(true)} />
        </div>
      )}

      {/* The same column, showing either the folder or what the header's field
          is looking for. The search takes the place of the list rather than
          covering the page, so the transcript to the right — and the note open
          in it — survives both entering and leaving a search. */}
      <section className="panel w-80 shrink-0 bg-surface">
        {search.active ? (
          <SearchResults
            state={search.state}
            rootLabel={rootLabel}
            selectedFile={selectedFile}
            onOpen={openResult}
            onRetry={search.retry}
          />
        ) : (
          <FileList
            state={states[selected]}
            folder={selected}
            breadcrumb={folderLabel(rootLabel, selected)}
            issueStates={folderIssueStates}
            selectedFile={selectedFile}
            onSelectFile={setSelectedFile}
            onRetry={() => reload(selected)}
          />
        )}
      </section>

      {/* Transcript and tasks share the rest of the row. With no file open the
          transcript takes all of it; once tasks appear they split it evenly and
          the divider between them is draggable, because how much room each
          needs depends on the meeting, not on a number picked here. */}
      <div ref={split.containerRef} className="flex min-h-0 min-w-0 flex-1 gap-2">
        <section
          aria-label="Transcripción"
          className="panel min-w-0 bg-surface"
          style={
            selectedFile
              ? { flex: `0 0 ${split.percent}%`, maxWidth: `${split.percent}%` }
              : { flex: '1 1 auto' }
          }
        >
          <TranscriptPreview state={transcript} onRetry={reloadTranscript} />
        </section>

        {selectedFile ? (
          <div
            {...split.handleProps}
            className="group relative -mx-1 flex w-2 shrink-0 cursor-col-resize items-center justify-center rounded-full focus-visible:outline-none"
          >
            {/* Nothing is drawn until the divider is aimed at: the gap between
                the two panels already separates them, so the grip only has to
                appear when it is about to be used. */}
            <span
              className={`h-8 w-1 rounded-full transition-colors ${
                split.dragging
                  ? 'bg-accent'
                  : 'bg-transparent group-hover:bg-line-strong group-focus-visible:bg-accent'
              }`}
            />
          </div>
        ) : null}

        {/* Tasks sit beside the transcript they came from, so you can check a
            row against the sentence that produced it without scrolling between
            them. The Linear controls ride on top as this column's header: the
            destination belongs with the thing being sent, and putting it in a
            full-width bar would separate the two. */}
        {selectedFile ? (
          <section aria-label="Tareas y envío a Linear" className="panel min-w-0 flex-1 bg-surface">
            <PushPanel
              target={target}
              parent={{
                create: pushOptions.options.createParent,
                title: parentTitle,
                onToggle: pushOptions.setCreateParent,
                onTitleChange: pushOptions.setParentTitle,
              }}
              duplicates={{
                status: duplicates.status,
                checking: duplicates.checking,
                error: duplicates.error,
                excluded: decisions.excluded,
                onCheck: duplicates.recheck,
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

            {history.length > 0 ? (
              <PushedHistory history={history} states={issueStates} />
            ) : null}

            {/* What the *other* meetings of this project left open, under what
                this one already produced: the note's own record first, then
                what it should be asked about. */}
            <PendingCommitments commitments={previousCommitments} onOpenNote={setSelectedFile} />

            <div className="flex min-h-0 flex-1">
              <TaskTable
                state={drafts.state}
                results={results}
                busy={run.state.status === 'running'}
                matches={duplicates.matches}
                forcedRows={decisions.forced}
                showDuplicates={duplicates.status !== 'unavailable'}
                checkingDuplicates={duplicates.checking}
                onGenerate={drafts.generate}
                onConfirmGenerate={drafts.confirmGenerate}
                onCancelGenerate={drafts.cancelGenerate}
                onUpdateRow={drafts.updateRow}
                onRemoveRow={drafts.removeRow}
                onAddRow={drafts.addRow}
                onRetryLoad={drafts.retryLoad}
              />
            </div>

            {/* What the same extraction found that is not work: below the
                table, outside it, and explicitly not going anywhere. It draws
                nothing at all until a meeting has decided, risked or asked
                something. */}
            {drafts.state ? <MeetingInsights insights={drafts.state} /> : null}
          </section>
        ) : null}
      </div>
    </div>
  )
}

/** Show/hide control for the folder tree. Icon-only when the tree is closed. */
function SidebarToggle({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      title={open ? 'Ocultar carpetas' : 'Mostrar carpetas'}
      className="rounded-md p-1 text-muted transition-colors hover:bg-line hover:text-content"
    >
      <span className="sr-only">{open ? 'Ocultar carpetas' : 'Mostrar carpetas'}</span>
      <svg
        viewBox="0 0 16 16"
        aria-hidden="true"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5" />
        <line x1="6" y1="2.75" x2="6" y2="13.25" />
        {open ? <polyline points="10.5,6 8.75,8 10.5,10" /> : <polyline points="9,6 10.75,8 9,10" />}
      </svg>
    </button>
  )
}

