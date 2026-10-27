import {
  createContext,
  useCallback,
  useContext,
  useEffect,
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

export function DialogProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null)
  const [promptValue, setPromptValue] = useState('')

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setPending({ kind: 'confirm', ...options, resolve })
    })
  }, [])

  const prompt = useCallback((options: PromptOptions) => {
    return new Promise<string | null>((resolve) => {
      setPromptValue(options.initialValue ?? '')
      setPending({ kind: 'prompt', ...options, resolve })
    })
  }, [])

  const resolveConflict = useCallback((options: ConflictOptions) => {
    return new Promise<ConflictChoice>((resolve) => {
      setPending({ kind: 'conflict', ...options, resolve })
    })
  }, [])

  const confirmCloseDirty = useCallback((options: CloseDirtyOptions) => {
    return new Promise<CloseDirtyChoice>((resolve) => {
      setPending({ kind: 'closeChoice', ...options, resolve })
    })
  }, [])

  useEffect(() => {
    if (!pending) {
      return
    }

    const dismiss = () => {
      if (pending.kind === 'confirm') {
        pending.resolve(false)
      } else if (pending.kind === 'prompt') {
        pending.resolve(null)
      } else {
        pending.resolve('cancel')
      }

      setPending(null)
    }

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        dismiss()
      }
    }

    document.addEventListener('keydown', onKey)

    return () => document.removeEventListener('keydown', onKey)
  }, [pending])

  const closeOverlay = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || !pending) {
      return
    }

    if (pending.kind === 'confirm') {
      pending.resolve(false)
    } else if (pending.kind === 'prompt') {
      pending.resolve(null)
    } else {
      pending.resolve('cancel')
    }

    setPending(null)
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
                    className="secondary-button"
                    onClick={() => {
                      pending.resolve(false)
                      setPending(null)
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    className={pending.danger ? 'danger-button' : 'primary-button'}
                    onClick={() => {
                      pending.resolve(true)
                      setPending(null)
                    }}
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

                  pending.resolve(promptValue.trim())
                  setPending(null)
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
                    onClick={() => {
                      pending.resolve(null)
                      setPending(null)
                    }}
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
                    className="secondary-button"
                    onClick={() => {
                      pending.resolve('cancel')
                      setPending(null)
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    className="danger-button"
                    onClick={() => {
                      pending.resolve('discard')
                      setPending(null)
                    }}
                  >
                    Discard changes
                  </button>
                  <button
                    className="primary-button"
                    onClick={() => {
                      pending.resolve('save')
                      setPending(null)
                    }}
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
                    className="secondary-button"
                    onClick={() => {
                      pending.resolve('cancel')
                      setPending(null)
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => {
                      pending.resolve('reload')
                      setPending(null)
                    }}
                  >
                    Reload disk version
                  </button>
                  <button
                    className="danger-button"
                    onClick={() => {
                      pending.resolve('overwrite')
                      setPending(null)
                    }}
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
