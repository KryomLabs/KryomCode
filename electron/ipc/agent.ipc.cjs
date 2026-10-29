const { ipcMain } = require('electron')

const {
  planTask,
  applyEdits,
  cancelPlan,
} = require('../services/agent/agent.service.cjs')
const {
  assertPlainObject,
  assertNonEmptyString,
  assertOptionalString,
  assertStringArray,
} = require('../security/validate-input.cjs')
const {
  gatherSourceContext,
} = require('../services/agent/context.service.cjs')

// Planning proposes; applying changes the disk. The renderer must show
// the plan and collect explicit approval before calling agent:apply.
// Commands in a plan are suggestions only and are never executed here.

function assertContextPaths(value) {
  if (value === undefined || value === null) {
    return undefined
  }

  return assertStringArray(value, 'context paths', {
    maxItems: 32,
    maxLength: 1000,
  })
}

module.exports = function registerAgentIPC({
  isTrustedSender,
}) {
  ipcMain.handle('agent:plan', async (event, payload) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized agent request.')
    }

    assertPlainObject(payload, 'agent task')
    assertNonEmptyString(payload.task, 'task', 4000)

    return planTask({
      task: payload.task,
      model: assertOptionalString(payload.model, 'model', 100) ?? undefined,
      contextPaths: assertContextPaths(payload.contextPaths),
      researchSessionId:
        assertOptionalString(payload.researchSessionId, 'researchSessionId', 64) ?? undefined,
    })
  })

  // Context preview: reports which selected files would reach the
  // model (and why others would not) WITHOUT sending contents, so
  // the user sees the selection before planning transmits anything.
  ipcMain.handle('agent:context', async (event, payload) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized agent request.')
    }

    assertPlainObject(payload, 'agent context request')

    const gathered = await gatherSourceContext(
      assertContextPaths(payload.paths) ?? []
    )

    return {
      files: gathered.files.map((file) => ({
        path: file.path,
        relativePath: file.relativePath,
        bytes: file.bytes,
      })),
      excluded: gathered.excluded,
      totalBytes: gathered.totalBytes,
    }
  })

  ipcMain.handle('agent:apply', async (event, payload) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized agent request.')
    }

    assertPlainObject(payload, 'apply payload')

    return applyEdits({ edits: payload.edits })
  })

  ipcMain.handle('agent:cancel', async (event) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized agent request.')
    }

    return cancelPlan()
  })
}
