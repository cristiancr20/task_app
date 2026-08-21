# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
pnpm dev          # dev server on http://127.0.0.1:3300
pnpm build        # production build
pnpm start        # production server, same host/port
pnpm typecheck    # next typegen && tsc --noEmit
pnpm test         # Vitest, one non-interactive run
pnpm test:watch   # Vitest in watch mode
```

Single test file or single case:

```bash
pnpm test lib/search.test.ts
pnpm test -t 'parte del nombre del caso'
```

`pnpm dev -H 0.0.0.0` overrides the `127.0.0.1` bind (the last `-H` wins). Do not
leave it on: the app has no authentication and `.data/` holds live API keys.

Env overrides, read once at process start (restart after changing):
`OLLAMA_URL`, `ANTHROPIC_API_URL`, `LINEAR_API_URL`. Pointing them at a stub is
how you exercise extraction or push without spending calls or creating issues.

## What the app does

Point it at a folder of Markdown meeting notes; an extraction engine (local
Ollama or the Anthropic API) turns a transcript into a list of tasks; the user
edits that list in a table and pushes what survives to Linear, optionally under
a parent issue representing the meeting. Everything — config, keys, drafts,
push history — stays on disk on the user's machine.

## Architecture

**Three layers, and the boundary between them is enforced by imports.**

- `app/api/**/route.ts` — thin HTTP shells. They parse params via `lib/api.ts`
  (`requireContextRoot`, `pathParam`, `requireMarkdownPath`, `jsonBody`), call
  into `lib/`, and funnel every failure through `errorResponse`, which maps the
  domain error classes (`HttpError`, `LinearApiError`, `LinearUnreachableError`,
  `OllamaUnreachableError`, `ExtractionError`, `PathEscapesRootError`) to a
  status and a Spanish message. Routes hold no logic worth testing.
- `lib/*.ts` — all the logic, and the only thing the test suite collects.
- `app/*.tsx` + `app/use-*.ts` — Client Components and hooks. Hooks keep only
  what is genuinely React (fetch, debounce, state keyed by path); the arithmetic
  they perform lives in `lib/` so it can be tested (`duplicate-check`,
  `drafts-changes`, `search-state`, `pending-commitments`, `inbox-state`).

**`lib/x.ts` vs `lib/x-client.ts`.** A `-client` module is the browser's half of
a route: `fetch` plus unwrapping, importing the server module **type-only** so
the code that reads `process.env`, the filesystem or an API key never enters the
client bundle. When adding a route, add its `-client` wrapper the same way; never
`fetch` inline from a component. `lib/push-events.ts` is the same idea for values
both sides need (`PARENT_ROW_ID`, event shapes) with no server imports at all.

**Mutations are Server Actions, reads are `/api` routes.** `app/settings/actions.ts`
and `app/actions.ts` write config and call `refresh()` when the server-rendered
page must re-render; `app/page.tsx` is `force-dynamic` because it reads `.data/`
on every render.

**Persistence.** `.data/` (git-ignored, `0700`) holds `config.json`
(`lib/store.ts`: context root, recents, provider + model, Anthropic and Linear
keys, push history) and `drafts.json` (`lib/drafts-store.ts`: the in-progress
task table per note). They are separate files on purpose — drafts churn on every
keystroke and must never be able to corrupt the keys. Every write goes through
`writeJsonFile` (`lib/atomic-write.ts`): temp file at `0600`, chmod, rename. A
corrupt file yields empty state instead of throwing. `instrumentation.ts` creates
`.data/` at boot on the node runtime only.

**Path safety.** The context root is the only reachable part of the filesystem.
`lib/transcripts.ts` re-validates every relative path against the root and throws
`PathEscapesRootError`; routes additionally reject anything that is not `.md`.
Never read a user-supplied path directly — go through `readTranscript` /
`listFolder` / `walkTranscripts`.

**The transcript index.** `lib/transcript-index.ts` caches one recursive walk per
root in server memory with a 30s TTL, deduping concurrent walks. Inbox and search
read metadata from it; note *bodies* are deliberately not cached and are read one
at a time by whoever needs them.

**Extraction.** `lib/extractors/task.ts` owns the contract — result types,
prompts, the JSON Schema handed to the model, and `normalizeExtraction`.
`./ollama.ts` and `./claude.ts` own only the HTTP for their provider, so their
outputs are indistinguishable. An extraction yields tasks *plus* decisions, risks
and open questions, all of which are stored in the drafts.

**The push** (`lib/linear-push.ts`) is an async generator: parent issue, then each
task sequentially, yielding events the route serialises as NDJSON so the UI can
show progress. It aborts after 3 consecutive failures. `lib/linear.ts` is the
whole GraphQL surface (verify key, list teams/projects, existing issues, issue
states, create issue).

**Rendering notes.** `lib/markdown.ts` is a hand-written parser producing a data
tree, never HTML, because transcripts are arbitrary files on disk; `app/markdown.tsx`
turns that tree into React. Search excerpts travel as text plus offsets for the
same reason. Do not introduce a Markdown dependency that emits HTML.

## Conventions

- User-facing strings, error messages and commit subjects are **Spanish**; code,
  identifiers and comments are **English**.
- Comments explain *why* a decision was made, often at length, at the top of a
  module. Match that density — a new `lib/` module is expected to open with a
  docstring stating what it owns and what it must not import.
- Commits are one user story: `story: US-00N <title>`. PRDs and their task
  breakdowns live in `tasks/`; `.ralph-tui/` is agent-run scaffolding.
