/**
 * The theme preference, shared by both sides of the app.
 *
 * Constants and types only: the toggle is a client component and imports this
 * module, so nothing here may reach for `next/headers` or the filesystem.
 * Reading the cookie lives in `lib/theme-server.ts`, writing it in
 * `lib/theme-action.ts`.
 */

export const THEME_COOKIE = 'TASKS_APP_THEME'

export const THEMES = ['light', 'dark', 'system'] as const

export type Theme = (typeof THEMES)[number]

/** Spanish label for each option, used by the toggle's tooltips and a11y names. */
export const THEME_LABELS: Record<Theme, string> = {
  light: 'Claro',
  dark: 'Oscuro',
  system: 'Sistema',
}

/** Narrow an untrusted value — a cookie, a client payload — to a Theme. */
export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value)
}

/**
 * The class that goes on `<html>`. «system» deliberately puts none: with no
 * class, the `color-scheme: light dark` of `:root` and the second branch of the
 * `dark` variant leave the operating system in charge (see app/globals.css).
 */
export function themeClass(theme: Theme): string {
  return theme === 'system' ? '' : theme
}
