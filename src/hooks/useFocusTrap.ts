// Focus trap for modal dialogs (Level 4B.7). Keeps Tab cycling inside
// the dialog while it is open and restores focus to the previously
// focused element on close. New dialogs use this; older dialogs keep
// their existing behavior until the UI redesign.
import { useEffect, useRef } from 'react'

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), ' +
  'input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function useFocusTrap<T extends HTMLElement>(active: boolean) {
  const ref = useRef<T | null>(null)

  useEffect(() => {
    if (!active || !ref.current) {
      return
    }

    const root = ref.current
    const previouslyFocused =
      typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') {
        return
      }

      const candidates = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (entry) => entry.offsetParent !== null || entry === document.activeElement
      )

      if (candidates.length === 0) {
        event.preventDefault()
        return
      }

      const first = candidates[0]
      const last = candidates[candidates.length - 1]
      const current = document.activeElement as HTMLElement | null

      if (event.shiftKey && (current === first || !root.contains(current))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (current === last || !root.contains(current))) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)

    return () => {
      document.removeEventListener('keydown', onKeyDown, true)

      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus()
      }
    }
  }, [active])

  return ref
}
