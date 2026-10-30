// Error boundary regression tests (audit F14): full-screen
// recovery plus the compact regional mode.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ErrorBoundary } from './ErrorBoundary'

function Boom(): never {
  throw new Error('boom-test')
}

describe('ErrorBoundary', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders recovery UI instead of crashing', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    )

    expect(screen.getByRole('alert')).not.toBeNull()
    expect(screen.getByText('Something went wrong.')).not.toBeNull()
    expect(screen.getByText('Reload KryomCode')).not.toBeNull()
  })

  it('renders inline in compact mode', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    render(
      <ErrorBoundary compact title="The sidebar crashed.">
        <Boom />
      </ErrorBoundary>
    )

    expect(screen.getByText(/The sidebar crashed\./)).not.toBeNull()
    expect(screen.getByText('Reload')).not.toBeNull()
  })
})
