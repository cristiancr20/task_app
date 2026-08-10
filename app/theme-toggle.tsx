'use client'

import { useOptimistic, useTransition } from 'react'

import { THEME_LABELS, THEMES, type Theme } from '@/lib/theme'
import { setTheme } from '@/lib/theme-action'

type Props = {
  /** The stored preference, read server-side so the right button starts active. */
  current: Theme
}

/**
 * Three-state segmented control: claro / oscuro / sistema.
 *
 * It shows the *preference*, not the resolved theme: with «Sistema» the server
 * has no way of knowing what the visitor's OS is set to — that is decided by
 * CSS (`color-scheme` and the `dark` variant, see globals.css). Painting the
 * preference avoids guessing, and it is also the more honest thing to show,
 * since the user picked one of three options and not one of two.
 */
export function ThemeToggle({ current }: Props) {
  const [pending, startTransition] = useTransition()
  // Writing the cookie costs a round trip to the server. The optimistic value
  // moves the highlight on click so the control does not feel stuck.
  const [shown, setShown] = useOptimistic(current)

  return (
    <div
      role="radiogroup"
      aria-label="Tema"
      className="flex shrink-0 items-center gap-0.5 rounded-md border border-zinc-300 p-0.5 dark:border-zinc-700"
    >
      {THEMES.map((theme) => {
        const active = shown === theme
        const Icon = ICONS[theme]

        return (
          <button
            key={theme}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={THEME_LABELS[theme]}
            title={THEME_LABELS[theme]}
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setShown(theme)
                await setTheme(theme)
              })
            }
            className={`flex size-7 items-center justify-center rounded transition-colors ${
              active
                ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50'
                : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100'
            }`}
          >
            <Icon />
          </button>
        )
      })}
    </div>
  )
}

/** Shared frame for the three glyphs: 16px, stroked, inheriting the text colour. */
function Glyph({ children }: { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

const ICONS: Record<Theme, () => React.ReactElement> = {
  light: () => (
    <Glyph>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </Glyph>
  ),
  dark: () => (
    <Glyph>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
    </Glyph>
  ),
  system: () => (
    <Glyph>
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </Glyph>
  ),
}
