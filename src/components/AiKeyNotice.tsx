import { useState } from 'react'

export interface AiKeyNoticeProps {
  onOpenConnections?: () => void
}

// Inline setup guidance when the model key is not configured. Shown
// before an AI request is attempted; never displays secret values.
export function AiKeyNotice(props: AiKeyNoticeProps) {
  const [dismissed, setDismissed] = useState(false)

  if (dismissed) {
    return null
  }

  return (
    <div className="ai-error" role="alert">
      <strong>AI model is not configured</strong>
      <p>
        Add <code>MODEL_API_KEY</code> to your local <code>.env</code> file,
        then restart KryomCode. Keys stay on your machine and are never
        shown here.
      </p>
      <div className="notice-actions">
        {props.onOpenConnections && (
          <button
            type="button"
            className="secondary-button"
            onClick={props.onOpenConnections}
          >
            Open Connections
          </button>
        )}
        <button
          type="button"
          className="secondary-button"
          onClick={() => setDismissed(true)}
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}
