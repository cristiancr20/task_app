<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Tests

Tests run on [Vitest](https://vitest.dev) against pure logic in `lib/`.

- `pnpm test` — one non-interactive run; this is what CI and agents use.
- `pnpm test:watch` — re-runs on change, for local development.

Conventions:

- Tests live next to the code they cover, as `lib/**/*.test.ts`. `lib/store.ts`
  is tested by `lib/store.test.ts`. Only that glob is collected.
- The test environment is `node`; there is no DOM. Cover pure functions and
  server-side logic, not React components.
- Import through the `@/` alias exactly as the app does — `import { getConfig }
  from '@/lib/store'`. `vitest.config.mts` mirrors the `paths` mapping in
  `tsconfig.json`.
- Import `describe`/`it`/`expect` from `vitest`; globals are not enabled.
- Tests must not depend on local machine state. `.data/` holds the real config,
  so exercise pure helpers rather than functions that read it.
