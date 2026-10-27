const { ipcMain } = require('electron')

const {
  planTask,
  applyEdits,
} = require('../services/agent/agent.service.cjs')
const {
  assertPlainObject,
  assertNonEmptyString,
  assertOptionalString,
} = require('../security/validate-input.cjs')

// Planning proposes; applying changes the disk. The renderer must show
// the plan and collect explicit approval before calling agent:apply.
// Commands in a plan are suggestions only and are never executed here.

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
      context: assertOptionalString(payload.context, 'context', 20000) ?? undefined,
    })
  })

  ipcMain.handle('agent:apply', async (event, payload) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized agent request.')
    }

    assertPlainObject(payload, 'apply payload')

    return applyEdits({ edits: payload.edits })
  })
}
