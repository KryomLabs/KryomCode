// Home hero: the centered AI search entry. Collects the first
// prompt per mode and hands it up; WelcomePage routes it to the
// existing chat/research backends. Pure presentational component —
// no backend calls here.
import { useState } from 'react'
import type { DiscoveryMode } from './WelcomePage'

export interface HomeHeroProps {
  mode: DiscoveryMode
  onModeChange: (mode: DiscoveryMode) => void
  onSubmit: (text: string) => void
}

export function HomeHero(props: HomeHeroProps) {
  const [value, setValue] = useState('')
  const ready = value.trim() !== ''

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const text = value.trim()

    if (text === '') {
      return
    }

    // The field is intentionally NOT cleared: on success the parent
    // navigates away (unmounting the hero), and on refusal the typed
    // text stays so the user never retypes.
    props.onSubmit(text)
  }

  return (
    <div className="hero">
      <div className="hero-mark" aria-hidden="true">
        K
      </div>
      <p className="hero-brand">KryomCode</p>
      <h1 className="hero-title">What should we build &amp; discover?</h1>
      <div className="segmented hero-modes" role="group" aria-label="Home mode">
        <button
          type="button"
          className={props.mode === 'chat' ? 'segment active' : 'segment'}
          aria-pressed={props.mode === 'chat'}
          onClick={() => props.onModeChange('chat')}
        >
          Chat
        </button>
        <button
          type="button"
          className={props.mode === 'research' ? 'segment active' : 'segment'}
          aria-pressed={props.mode === 'research'}
          onClick={() => props.onModeChange('research')}
        >
          Research
        </button>
      </div>
      <p className="hero-hint">
        {props.mode === 'chat'
          ? 'Conversational answers with your project context.'
          : 'Structured investigation with cited sources.'}
      </p>
      <form className="hero-form" onSubmit={submit}>
        <input
          type="text"
          autoFocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={
            props.mode === 'chat'
              ? 'Ask about your code…'
              : 'What should we investigate?'
          }
          aria-label={props.mode === 'chat' ? 'Chat prompt' : 'Research topic'}
        />
        <button
          type="submit"
          className="primary-button hero-send"
          disabled={!ready}
          aria-label="Send"
        >
          Send
        </button>
      </form>
      <p className="hero-keys">Enter to send</p>
    </div>
  )
}
