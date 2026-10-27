import { useRef } from 'react'

export interface ResizeHandleProps {
  orientation: 'vertical' | 'horizontal'
  // +1 when growing the value moves the divider right/down (left panel,
  // top area), -1 when it moves left/up (right panel, bottom panel).
  direction: 1 | -1
  label: string
  value: number
  min: number
  max: number
  onResize: (value: number) => void
  onResizeEnd: () => void
}

const KEY_STEP = 12
const KEY_BIG_STEP = 48

// Thin draggable divider between panels. Pointer drags are coalesced
// through requestAnimationFrame; keyboard users get arrow-key resizing.
export function ResizeHandle(props: ResizeHandleProps) {
  const drag = useRef<{ startPos: number; startValue: number } | null>(null)
  const frame = useRef<number | null>(null)

  function clamp(value: number): number {
    return Math.min(props.max, Math.max(props.min, Math.round(value)))
  }

  function posOf(event: { clientX: number; clientY: number }): number {
    return props.orientation === 'vertical' ? event.clientX : event.clientY
  }

  function valueAt(clientPos: number): number {
    if (!drag.current) {
      return props.value
    }

    return clamp(
      drag.current.startValue +
        (clientPos - drag.current.startPos) * props.direction
    )
  }

  function scheduleResize(next: number) {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current)
    }

    frame.current = requestAnimationFrame(() => {
      frame.current = null
      props.onResize(next)
    })
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { startPos: posOf(event), startValue: props.value }
    document.documentElement.classList.add('kryom-resizing')
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!drag.current) {
      return
    }

    scheduleResize(valueAt(posOf(event)))
  }

  function endDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (!drag.current) {
      return
    }

    // Flush the final position synchronously so the last move is never
    // dropped when the frame callback is still pending.
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current)
      frame.current = null
    }

    props.onResize(valueAt(posOf(event)))
    drag.current = null
    document.documentElement.classList.remove('kryom-resizing')
    props.onResizeEnd()
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? KEY_BIG_STEP : KEY_STEP
    let dividerDelta: number | null = null

    if (props.orientation === 'vertical') {
      if (event.key === 'ArrowLeft') dividerDelta = -step
      else if (event.key === 'ArrowRight') dividerDelta = step
    } else {
      if (event.key === 'ArrowUp') dividerDelta = -step
      else if (event.key === 'ArrowDown') dividerDelta = step
    }

    if (event.key === 'Home') {
      event.preventDefault()
      props.onResize(props.min)
      props.onResizeEnd()
      return
    }

    if (event.key === 'End') {
      event.preventDefault()
      props.onResize(props.max)
      props.onResizeEnd()
      return
    }

    if (dividerDelta === null) {
      return
    }

    event.preventDefault()
    props.onResize(clamp(props.value + dividerDelta * props.direction))
    props.onResizeEnd()
  }

  return (
    <div
      role="separator"
      aria-orientation={props.orientation}
      aria-label={props.label}
      aria-valuenow={Math.round(props.value)}
      aria-valuemin={props.min}
      aria-valuemax={props.max}
      tabIndex={0}
      className={`resize-handle resize-${props.orientation}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onKeyDown={onKeyDown}
    />
  )
}
