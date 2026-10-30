// Dialog system regression tests (audit F14): FIFO queueing, choice
// resolution, Escape dismissal, prompt trimming, and danger focus.
import { useEffect } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  DialogProvider,
  useDialogs,
  type ConfirmOptions,
  type ConflictChoice,
  type ConflictOptions,
  type PromptOptions,
} from './dialogs'

type Api = ReturnType<typeof useDialogs>

function Harness({ onApi }: { onApi: (api: Api) => void }) {
  const api = useDialogs()

  useEffect(() => {
    onApi(api)
  }, [api, onApi])

  return null
}

function setup(): Api {
  let api: Api | null = null

  render(
    <DialogProvider>
      <Harness
        onApi={(entry) => {
          api = entry
        }}
      />
    </DialogProvider>
  )

  if (!api) {
    throw new Error('dialog API was not captured')
  }

  return api
}

// The starters below wrap dialog calls in act() and prove the promise
// was captured with a runtime guard (a cast would lie to the
// type-checker, which cannot see assignments made inside act()).
function startConfirm(api: Api, options: ConfirmOptions): Promise<boolean> {
  let pending: Promise<boolean> | null = null

  act(() => {
    pending = api.confirm(options)
  })

  if (!pending) {
    throw new Error('confirm did not start')
  }

  return pending
}

function startPrompt(
  api: Api,
  options: PromptOptions
): Promise<string | null> {
  let pending: Promise<string | null> | null = null

  act(() => {
    pending = api.prompt(options)
  })

  if (!pending) {
    throw new Error('prompt did not start')
  }

  return pending
}

function startConflict(
  api: Api,
  options: ConflictOptions
): Promise<ConflictChoice> {
  let pending: Promise<ConflictChoice> | null = null

  act(() => {
    pending = api.resolveConflict(options)
  })

  if (!pending) {
    throw new Error('conflict dialog did not start')
  }

  return pending
}

describe('dialogs', () => {
  it('resolves confirm choices', async () => {
    const api = setup()
    const first = startConfirm(api, {
      title: 'Delete?',
      message: 'Sure?',
      confirmLabel: 'Delete it',
    })

    expect(screen.getByRole('dialog')).not.toBeNull()
    fireEvent.click(screen.getByText('Delete it'))
    await expect(first).resolves.toBe(true)

    const second = startConfirm(api, { title: 'Again?', message: 'Sure?' })

    fireEvent.click(screen.getByText('Cancel'))
    await expect(second).resolves.toBe(false)
  })

  it('queues concurrent dialogs FIFO', async () => {
    const api = setup()
    const first = startConfirm(api, { title: 'First dialog', message: 'one' })
    const second = startConfirm(api, {
      title: 'Second dialog',
      message: 'two',
    })

    expect(screen.getByText('First dialog')).not.toBeNull()
    expect(screen.queryByText('Second dialog')).toBeNull()

    fireEvent.click(screen.getByText('Confirm'))
    await expect(first).resolves.toBe(true)

    expect(screen.getByText('Second dialog')).not.toBeNull()

    fireEvent.click(screen.getByText('Cancel'))
    await expect(second).resolves.toBe(false)
  })

  it('prompts for trimmed text and blocks empty submit', async () => {
    const api = setup()
    const pending = startPrompt(api, {
      title: 'New file',
      label: 'Name',
      confirmLabel: 'Create',
    })

    const input = screen.getByLabelText('Name')
    const create = screen.getByText('Create') as HTMLButtonElement

    expect(create.disabled).toBe(true)

    fireEvent.change(input, { target: { value: '  notes.md  ' } })
    fireEvent.click(create)

    await expect(pending).resolves.toBe('notes.md')
  })

  it('dismisses the head dialog on Escape', async () => {
    const api = setup()
    const pending = startConfirm(api, { title: 'Escape me', message: 'x' })

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })

    await expect(pending).resolves.toBe(false)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('resolves write-conflict choices', async () => {
    const api = setup()
    const pending = startConflict(api, { fileName: 'a.ts' })

    fireEvent.click(screen.getByText('Reload disk version'))

    await expect(pending).resolves.toBe('reload')
  })

  it('autofocuses the safe choice on danger confirms', () => {
    const api = setup()

    startConfirm(api, { title: 'Danger', message: 'x', danger: true })

    expect(document.activeElement?.textContent).toBe('Cancel')
  })
})
