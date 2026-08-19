'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/** Neither pane may be squeezed past this share of the pair. */
const MIN_PERCENT = 25
const MAX_PERCENT = 75

export type SplitApi = {
  /** Ref for the element the two panes live in — the drag measures against it. */
  containerRef: React.RefObject<HTMLDivElement | null>
  /** Width of the first pane, as a percentage of the pair. */
  percent: number
  /** True while the handle is held, so panes can suppress text selection. */
  dragging: boolean
  /** Props to spread on the divider element. */
  handleProps: {
    onPointerDown: (event: React.PointerEvent) => void
    onKeyDown: (event: React.KeyboardEvent) => void
    role: 'separator'
    tabIndex: 0
    'aria-orientation': 'vertical'
    'aria-valuenow': number
    'aria-valuemin': number
    'aria-valuemax': number
    'aria-label': string
  }
}

/**
 * A draggable vertical divider between two panes.
 *
 * Pointer events rather than mouse events, so a trackpad, a touchscreen and a
 * pen all work from one code path, and `setPointerCapture` keeps the drag alive
 * when the cursor outruns the 6px handle — without it, moving fast drops the
 * drag halfway across the screen.
 *
 * Keyboard arrows move it too: a divider that only answers to a mouse is
 * unreachable for anyone who does not use one.
 */
export function useSplit(initialPercent = 50): SplitApi {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [percent, setPercent] = useState(initialPercent)
  const [dragging, setDragging] = useState(false)

  const clamp = (value: number) => Math.min(MAX_PERCENT, Math.max(MIN_PERCENT, value))

  const applyFromClientX = useCallback((clientX: number) => {
    const box = containerRef.current?.getBoundingClientRect()
    if (!box || box.width === 0) return
    setPercent(clamp(((clientX - box.left) / box.width) * 100))
  }, [])

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
  }, [])

  // Listening on the window rather than the handle: the capture keeps events
  // coming, but a listener on the element still misses the frames where the
  // pointer is over an iframe or outside the document.
  useEffect(() => {
    if (!dragging) return

    const onMove = (event: PointerEvent) => applyFromClientX(event.clientX)
    const stop = () => setDragging(false)

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)

    // A drag must not paint the page blue as it crosses text.
    const previousUserSelect = document.body.style.userSelect
    const previousCursor = document.body.style.cursor
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'

    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      document.body.style.userSelect = previousUserSelect
      document.body.style.cursor = previousCursor
    }
  }, [dragging, applyFromClientX])

  const onKeyDown = useCallback((event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 10 : 2
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      setPercent((p) => clamp(p - step))
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      setPercent((p) => clamp(p + step))
    } else if (event.key === 'Home') {
      event.preventDefault()
      setPercent(50)
    }
  }, [])

  return {
    containerRef,
    percent,
    dragging,
    handleProps: {
      onPointerDown,
      onKeyDown,
      role: 'separator',
      tabIndex: 0,
      'aria-orientation': 'vertical',
      'aria-valuenow': Math.round(percent),
      'aria-valuemin': MIN_PERCENT,
      'aria-valuemax': MAX_PERCENT,
      'aria-label': 'Ajustar el ancho entre transcripción y tareas',
    },
  }
}
