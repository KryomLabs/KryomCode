const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs/promises')

const {
  AUDIT_TYPES,
  appendAudit,
  listAudit,
} = require('./audit.service.cjs')

async function tempBase() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'kryom-audit-'))
}

describe('audit', () => {
  it('appends and lists redacted events newest-first', async () => {
    const base = await tempBase()

    await appendAudit('permission.granted', { subject: 'extension:a.b', detail: 'workspace.read' }, base)
    await appendAudit(
      'security.denial',
      { subject: 'extension:a.b', detail: 'Bearer sk-secret-key denied', outcome: 'denied' },
      base
    )

    const listed = await listAudit({ baseDir: base })

    assert.equal(listed.total, 2)
    assert.equal(listed.events[0].type, 'security.denial')
    assert.ok(!listed.events[0].detail.includes('sk-secret-key'))
    assert.ok(AUDIT_TYPES.includes('extension.installed'))
  })

  it('records provider key save/remove events', async () => {
    const base = await tempBase()

    await appendAudit('provider.key-saved', { subject: 'meta', detail: 'stored' }, base)
    await appendAudit('provider.key-removed', { subject: 'meta', detail: 'removed' }, base)

    const listed = await listAudit({ baseDir: base })

    assert.equal(listed.total, 2)
    assert.ok(listed.events.some((entry) => entry.type === 'provider.key-saved'))
    assert.ok(listed.events.some((entry) => entry.type === 'provider.key-removed'))
  })

  it('rejects unknown event types and skips corrupt lines', async () => {
    const base = await tempBase()

    await assert.rejects(() => appendAudit('nope.nope', {}, base), /Unknown audit event/)

    await fs.writeFile(
      path.join(base, 'kryomcode-audit.jsonl'),
      '{corrupt\n{"at":"x","type":"permission.granted","subject":null,"detail":"","outcome":null}\n'
    )

    const listed = await listAudit({ baseDir: base })

    assert.equal(listed.total, 1)
  })
})
