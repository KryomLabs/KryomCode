// Home hero tests: branding, mode switching, and prompt submit.
// The submit path goes through the form's onSubmit (jsdom does not
// perform implicit Enter-to-submit, so keyboard handling is covered
// by asserting the form wiring, not a key event).
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { HomeHero } from './HomeHero'

function setup(mode: 'chat' | 'research' = 'chat') {
  const onModeChange = vi.fn()
  const onSubmit = vi.fn()

  render(<HomeHero mode={mode} onModeChange={onModeChange} onSubmit={onSubmit} />)

  return { onModeChange, onSubmit }
}

describe('HomeHero', () => {
  it('renders branding, headline, and both modes', () => {
    setup()
    expect(screen.getByText('KryomCode')).not.toBeNull()
    expect(screen.getByText('What should we build & discover?')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Chat' })).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Research' })).not.toBeNull()
  })

  it('marks the active mode pressed', () => {
    setup('research')
    expect(screen.getByRole('button', { name: 'Chat' }).getAttribute('aria-pressed')).toBe(
      'false'
    )
    expect(
      screen.getByRole('button', { name: 'Research' }).getAttribute('aria-pressed')
    ).toBe('true')
  })

  it('switches modes through the segmented control', () => {
    const { onModeChange } = setup('chat')
    fireEvent.click(screen.getByRole('button', { name: 'Research' }))
    expect(onModeChange).toHaveBeenCalledWith('research')
  })

  it('shows a mode-specific hint and prompt', () => {
    setup('research')
    expect(screen.getByText(/cited sources/)).not.toBeNull()
    expect(screen.getByLabelText('Research topic')).not.toBeNull()
  })

  it('keeps Send disabled until text is entered', () => {
    setup()
    const send = screen.getByRole('button', { name: 'Send' })
    expect((send as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Chat prompt'), {
      target: { value: '  ' },
    })
    expect((send as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Chat prompt'), {
      target: { value: 'hello' },
    })
    expect((send as HTMLButtonElement).disabled).toBe(false)
  })

  it('submits trimmed text and keeps the field', () => {
    const { onSubmit } = setup()
    const input = screen.getByLabelText('Chat prompt')
    fireEvent.change(input, { target: { value: '  explain this  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(onSubmit).toHaveBeenCalledWith('explain this')
    // The parent navigates on success; the hero never eats text.
    expect((input as HTMLInputElement).value).toBe('  explain this  ')
  })

  it('never submits blank text', () => {
    const { onSubmit } = setup()
    fireEvent.change(screen.getByLabelText('Chat prompt'), {
      target: { value: '   ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' })
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
