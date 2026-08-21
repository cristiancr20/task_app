'use client'

import { useEffect, useRef, useState } from 'react'

import type { MeetingInsights as Insights } from '@/lib/extractors/task'
import {
  hasInsights,
  INSIGHT_HEADINGS,
  INSIGHT_KINDS,
  insightEntries,
  insightsCount,
  insightsMarkdown,
  listMarkdown,
  type InsightEntry,
  type InsightKind,
} from '@/lib/insights-markdown'

type Props = {
  /** The three lists of the selected note, as the last extraction left them. */
  insights: Insights
}

/** How long «Copiado» stays on the button before it goes back to «Copiar». */
const FEEDBACK_MS = 2000

/**
 * «Lo que la reunión supo»: the decisions, the risks and the open questions,
 * inside the «La reunión» pestaña and nowhere else in the column.
 *
 * The whole design of this block is the sentence «sin que se mezcle con las
 * tareas que voy a enviar»:
 *
 * - It is not in the same panel as the table at all. It used to sit under it
 *   on a recessed fill, which is why it still carries one — the fill now
 *   separates it from the commitments above rather than from rows below.
 * - It says so out loud, once, in the header: «No se envía a Linear». Nothing
 *   in it has a checkbox, a state or a destination, because nothing in it has
 *   one — the push counts `rows`, and these lists are not rows.
 * - It disappears entirely when the extraction found none of the three, and
 *   each list disappears on its own, so an empty one never costs a heading.
 *   That is what lets the pestaña be *disabled* rather than opening onto a
 *   panel with two invisible blocks in it: `columnCounts` adds these three
 *   lists to the commitments, and zero is zero on both sides.
 *
 * The only thing that can be done with these lists is to take them somewhere
 * else, so every list carries its own «Copiar» and the header carries the one
 * that takes all three. The Markdown they copy is `lib/insights-markdown.ts`,
 * built from the very entries drawn below — what was read is what is pasted.
 */
export function MeetingInsights({ insights }: Props) {
  const [open, setOpen] = useState(true)

  // After the hooks: the block comes and goes with the note on screen, and a
  // hook that ran conditionally would take the fold state with it.
  if (!hasInsights(insights)) return null

  const kinds = INSIGHT_KINDS.filter((kind) => insightEntries(insights, kind).length > 0)

  return (
    <section
      aria-label="Decisiones, riesgos y preguntas"
      className="shrink-0 bg-surface-2 px-3 py-2.5"
    >
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen((it) => !it)}
          aria-expanded={open}
          aria-controls="meeting-insights-lists"
          className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-content"
        >
          <Chevron open={open} />
          Lo que la reunión supo
          <span className="font-normal text-muted tabular-nums">
            · {insightsCount(insights)}
          </span>
        </button>

        <div className="flex shrink-0 items-center gap-1.5">
          {/* Said next to the copy control rather than in a footnote: this is
              the moment somebody could believe these lists travel with the
              tasks below them. */}
          <span className="chip">No se envía a Linear</span>
          <CopyButton
            markdown={insightsMarkdown(insights)}
            label="Copiar todo"
            title="Copiar las tres listas como Markdown"
          />
        </div>
      </div>

      {open ? (
        // Uncapped, and scrolled by the panel rather than by itself. The cap
        // was here to stop three long lists pushing the task table off the
        // column; the table is in another pestaña now, so a second scroll area
        // inside one that already scrolls would only steal the wheel.
        <div id="meeting-insights-lists" className="mt-2 flex flex-col gap-3">
          {kinds.map((kind) => (
            <List key={kind} insights={insights} kind={kind} />
          ))}
        </div>
      ) : null}
    </section>
  )
}

/**
 * One of the three lists, with its own heading, its count and its own copy
 * control — a meeting's decisions are pasted into a different place than its
 * open questions, so copying them one at a time is the ordinary case and
 * «Copiar todo» is the shortcut.
 *
 * Never rendered for an empty list: the caller filters those out, so a heading
 * on screen always has items under it.
 */
function List({ insights, kind }: { insights: Insights; kind: InsightKind }) {
  const entries = insightEntries(insights, kind)

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <h3 className="panel-title">
          {INSIGHT_HEADINGS[kind]}
          <span className="ml-1.5 font-normal tabular-nums">{entries.length}</span>
        </h3>
        <CopyButton
          markdown={listMarkdown(insights, kind)}
          label="Copiar"
          title={`Copiar «${INSIGHT_HEADINGS[kind]}» como Markdown`}
        />
      </div>

      <ul className="mt-1 flex flex-col gap-1">
        {entries.map((entry, at) => (
          <Item key={`${kind}-${at}`} entry={entry} />
        ))}
      </ul>
    </div>
  )
}

/**
 * One decision, risk or open question: what it says, who decided it or what it
 * puts at stake, and the line of the transcript behind it.
 *
 * The evidence is folded rather than shown, unlike a task's: a task is edited
 * against its quote before being sent, while these are read — and three lists
 * of quotes at once would bury the text they are supposed to support. It is
 * one click away all the same, because a decision nobody can trace back to the
 * meeting is exactly as untrustworthy as an invented task.
 */
function Item({ entry }: { entry: InsightEntry }) {
  return (
    <li className="rounded-lg border border-line bg-surface px-2.5 py-1.5">
      <p className="text-xs leading-snug text-content">
        {entry.text}
        {entry.note ? <span className="text-muted"> · {entry.note}</span> : null}
      </p>

      {entry.evidence ? (
        <details className="mt-1">
          <summary className="cursor-pointer list-none text-[0.6875rem] text-muted underline underline-offset-2 transition-colors hover:text-content">
            Ver evidencia
          </summary>
          <q className="mt-1 block max-h-16 overflow-y-auto rounded-r-md border-l-2 border-accent/30 bg-surface-2/70 py-1 pl-2 pr-1 text-[0.6875rem] italic leading-snug text-muted">
            {entry.evidence}
          </q>
        </details>
      ) : null}
    </li>
  )
}

/**
 * Copy `markdown` to the clipboard, and say what happened.
 *
 * Both outcomes are said on the button itself and both fade back: a copy is
 * invisible by nature — nothing on the page changes — so the only proof the
 * user gets that it worked is this word, and the only warning that it did not
 * is this one. The clipboard is refused outright in an insecure context, which
 * is why the absence of the API is treated as a failure rather than awaited.
 */
function CopyButton({
  markdown,
  label,
  title,
}: {
  markdown: string
  label: string
  title: string
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => clearTimeout(timer.current ?? undefined), [])

  async function copy() {
    try {
      if (!navigator.clipboard) throw new Error('Sin portapapeles')
      await navigator.clipboard.writeText(markdown)
      setState('copied')
    } catch {
      setState('failed')
    }

    clearTimeout(timer.current ?? undefined)
    timer.current = setTimeout(() => setState('idle'), FEEDBACK_MS)
  }

  const tone =
    state === 'failed'
      ? 'border-danger/40 text-danger'
      : state === 'copied'
        ? 'border-ok/40 text-ok'
        : 'border-line-strong text-content'

  return (
    <button
      type="button"
      onClick={copy}
      title={title}
      className={`rounded-lg border bg-surface px-2 py-0.5 text-[0.6875rem] font-medium shadow-panel transition-colors hover:bg-surface-2 ${tone}`}
    >
      {/* The word is what changes, so it is what gets announced — and only
          when it changes, which is why the label itself is outside. */}
      <span aria-live="polite">
        {state === 'copied' ? 'Copiado' : state === 'failed' ? 'No se pudo copiar' : label}
      </span>
    </button>
  )
}

/** The fold indicator, pointing down when the lists are open. */
function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={`size-3 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="6,3.5 10.5,8 6,12.5" />
    </svg>
  )
}
