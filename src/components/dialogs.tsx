import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'

export interface ConfirmOptions {
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
}

export interface PromptOptions {
  title: string
  label: string
  initialValue?: string
  placeholder?: string
  confirmLabel?: string
}

export interface ConflictOptions {
  fileName: string
}

export type ConflictChoice = 'reload' | 'overwrite' | 'cancel'

export interface CloseDirtyOptions {
  fileName: string
}

export type CloseDirtyChoice = 'save' | 'discard' | 'cancel'

interface DialogsApi {
  confirm: (options: ConfirmOptions) => Promise<boolean>
  prompt: (options: PromptOptions) => Promise<string | null>
  resolveConflict: (options: ConflictOptions) => Promise<ConflictChoice>
  confirmCloseDirty: (options: CloseDirtyOptions) => Promise<CloseDirtyChoice>
}

const DialogsContext = createContext<DialogsApi | null>(null)

export function useDialogs(): DialogsApi {
  const api = useContext(DialogsContext)

  if (!api) {
    throw new Error('useDialogs must be used inside DialogProvider')
  }

  return api
}

type Pending =
  | ({ kind: 'confirm' } & ConfirmOptions & { resolve: (value: boolean) => void })
  | ({ kind: 'prompt' } & PromptOptions & { resolve: (value: string | null) => void })
  | ({ kind: 'conflict' } & ConflictOptions & { resolve: (value: ConflictChoice) => void })
  | ({ kind: 'closeChoice' } & CloseDirtyOptions & { resolve: (value: CloseDirtyChoice) => void })

type PendingValue =
  | boolean
  | string
  | null
  | ConflictChoice
  | CloseDirtyChoice

export function DialogProvider({ children }: { children: ReactNode }) {
  // FIFO queue: concurrent requests wait their turn instead of
  // overwriting each other and stranding promises forever.
  const [queue, setQueue] = useState<Pending[]>([])
  const [promptValue, setPromptValue] = useState('')
  const dialogNodeRef = useRef<HTMLDivElement | null>(null)
  const returnFocusRef = useRef<Element | null>(null)
  const hadDialogRef = useRef(false)

  const pending = queue[0] ?? null

  const enqueue = useCallback((entry: Pending) => {
    setQueue((current) => [...current, entry])
  }, [])

  // Resolves the head dialog and advances the queue. Functional
  // update: safe from Escape/overlay closures of any age.
  const settleHead = useCallback((value: PendingValue) => {
    setQueue((current) => {
      const [head, ...rest] = current

      if (head) {
        const resolve = head.resolve as (result: PendingValue) => void

        resolve(value)
      }

      return rest
    })
  }, [])

  const dismissHead = useCallback(() => {
    setQueue((current) => {
      const [head, ...rest] = current

      if (!head) {
        return current
      }

      if (head.kind === 'confirm') {
        head.resolve(false)
      } else if (head.kind === 'prompt') {
        head.resolve(null)
      } else {
        head.resolve('cancel')
      }

      return rest
    })
  }, [])

  const confirm = useCallback(
    (options: ConfirmOptions) => {
      return new Promise<boolean>((resolve) => {
        enqueue({ kind: 'confirm', ...options, resolve })
      })
    },
    [enqueue]
  )

  const prompt = useCallback(
    (options: PromptOptions) => {
      return new Promise<string | null>((resolve) => {
        enqueue({ kind: 'prompt', ...options, resolve })
      })
    },
    [enqueue]
  )

  const resolveConflict = useCallback(
    (options: ConflictOptions) => {
      return new Promise<ConflictChoice>((resolve) => {
        enqueue({ kind: 'conflict', ...options, resolve })
      })
    },
    [enqueue]
  )

  const confirmCloseDirty = useCallback(
    (options: CloseDirtyOptions) => {
      return new Promise<CloseDirtyChoice>((resolve) => {
        enqueue({ kind: 'closeChoice', ...options, resolve })
      })
    },
    [enqueue]
  )

  // Prompt input resets per dialog head.
  useEffect(() => {
    if (pending?.kind === 'prompt') {
      setPromptValue(pending.initialValue ?? '')
    }
  }, [pending])

  // Focus trap while any dialog is open; focus returns to the
  // invoking element only when the queue fully drains.
  useEffect(() => {
    if (queue.length === 0) {
      if (hadDialogRef.current) {
        hadDialogRef.current = false

        const target = returnFocusRef.current

        returnFocusRef.current = null

        if (target instanceof HTMLElement) {
          target.focus()
        }
      }

      return
    }

    if (!hadDialogRef.current) {
      hadDialogRef.current = true
      returnFocusRef.current = document.activeElement
    }

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        dismissHead()
        return
      }

      if (event.key !== 'Tab') {
        return
      }

      const node = dialogNodeRef.current

      if (!node) {
        return
      }

      const focusables = node.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )

      if (focusables.length === 0) {
        return
      }

      const first = focusables[0]
      const last = focusables[focusables.length - 1]

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKey)

    return () => document.removeEventListener('keydown', onKey)
  }, [queue.length, pending, dismissHead])

  const closeOverlay = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || !pending) {
      return
    }

    dismissHead()
  }

  return (
    <DialogsContext.Provider
      value={{ confirm, prompt, resolveConflict, confirmCloseDirty }}
    >
      {children}

      {pending && (
        <div className="dialog-overlay" onClick={closeOverlay}>
          <div
            className="dialog"
            role="dialog"
            aria-modal="true"
            ref={dialogNodeRef}
            aria-label={
              pending.kind === 'conflict'
                ? 'Unsaved changes conflict'
                : pending.kind === 'closeChoice'
                  ? 'Unsaved changes'
                  : pending.title
            }
          >
            {pending.kind === 'confirm' && (
              <>
                <h2>{pending.title}</h2>
                <p>{pending.message}</p>
                <div className="dialog-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => settleHead(false)}
                    autoFocus={pending.danger === true}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className={pending.danger ? 'danger-button' : 'primary-button'}
                    onClick={() => settleHead(true)}
                    // eslint-disable-next-line jsx-a11y/no-autofocus
                    autoFocus={!pending.danger}
                  >
                    {pending.confirmLabel ?? 'Confirm'}
                  </button>
                </div>
              </>
            )}

            {pending.kind === 'prompt' && (
              <form
                onSubmit={(event) => {
                  event.preventDefault()

                  if (!promptValue.trim()) {
                    return
                  }

                  settleHead(promptValue.trim())
                }}
              >
                <h2>{pending.title}</h2>
                <label className="field-label">
                  {pending.label}
                  <input
                    value={promptValue}
                    onChange={(event) => setPromptValue(event.target.value)}
                    placeholder={pending.placeholder ?? ''}
                    aria-label={pending.label}
                    autoFocus
                  />
                </label>
                <div className="dialog-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => settleHead(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="primary-button"
                    disabled={!promptValue.trim()}
                  >
                    {pending.confirmLabel ?? 'Confirm'}
                  </button>
                </div>
              </form>
            )}

            {pending.kind === 'closeChoice' && (
              <>
                <h2>Unsaved changes</h2>
                <p>
                  {pending.fileName} has unsaved changes. Save them
                  before closing, discard them, or cancel.
                </p>
                <div className="dialog-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => settleHead('cancel')}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="danger-button"
                    onClick={() => settleHead('discard')}
                  >
                    Discard changes
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => settleHead('save')}
                    autoFocus
                  >
                    Save and close
                  </button>
                </div>
              </>
            )}

            {pending.kind === 'conflict' && (
              <>
                <h2>Unsaved changes conflict</h2>
                <p>
                  {pending.fileName} changed on disk since it was opened.
                  Reloading discards your editor content. Overwriting
                  replaces the disk version with your editor content.
                </p>
                <div className="dialog-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => settleHead('cancel')}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => settleHead('reload')}
                  >
                    Reload disk version
                  </button>
                  <button
                    type="button"
                    className="danger-button"
                    onClick={() => settleHead('overwrite')}
                  >
                    Overwrite disk version
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </DialogsContext.Provider>
  )
}
