const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs/promises')

const {
  setWorkspaceRoot,
} = require('../workspace/workspace.service.cjs')
const {
  refreshIndex,
} = require('./code-index.service.cjs')
const {
  analyzeImpact,
} = require('./impact-analysis.service.cjs')

async function openFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-impact-'))
  await fs.mkdir(path.join(root, 'src'), { recursive: true })
  await fs.writeFile(path.join(root, 'src', 'store.ts'), 'export class Store {}\n')
  await fs.writeFile(
    path.join(root, 'src', 'service.ts'),
    'import { Store } from "./store"\nexport class Service {}\n'
  )
  await fs.writeFile(
    path.join(root, 'src', 'app.ts'),
    'import { Service } from "./service"\nnew Service()\n'
  )
  await fs.writeFile(
    path.join(root, 'src', 'service.test.ts'),
    'import { Service } from "./service"\n'
  )
  await fs.writeFile(
    path.join(root, 'src', 'external.ts'),
    'import _ from "lodash"\nimport x from "@/alias/mod"\n'
  )
  await setWorkspaceRoot(root)
  await refreshIndex()

  return root
}

describe('impact-analysis', () => {
  it('finds direct and indirect dependents with evidence', async () => {
    await openFixture()

    const result = await analyzeImpact({ paths: ['src/store.ts'] })
    const direct = result.directDependents.map((entry) => entry.file)
    const indirect = result.indirectDependents.map((entry) => entry.file)

    assert.ok(direct.includes('src/service.ts'))
    assert.ok(indirect.includes('src/app.ts'))
    assert.ok(result.evidence.length >= 1)
    assert.ok(result.evidence[0].excerpt.includes('./store'))
    assert.ok(result.risks.length >= 1)
  })

  it('identifies related tests', async () => {
    await openFixture()

    const result = await analyzeImpact({ paths: ['src/service.ts'] })

    assert.ok(result.relatedTests.includes('src/service.test.ts'))
    assert.ok(
      result.risks.some((entry) => entry.reason.includes('test file'))
    )
  })

  it('reports unresolvable imports honestly instead of guessing', async () => {
    await openFixture()

    const result = await analyzeImpact({ paths: ['src/external.ts'] })

    assert.ok(result.unresolvedImports.some((entry) => entry.specifier === 'lodash'))
    assert.ok(result.unresolvedImports.some((entry) => entry.specifier.startsWith('@/')))
  })

  it('refuses stale targets with a refresh instruction', async () => {
    const root = await openFixture()

    await fs.writeFile(path.join(root, 'src', 'store.ts'), 'stale\n')
    await assert.rejects(
      () => analyzeImpact({ paths: ['src/store.ts'] }),
      /Refresh the index first/
    )
  })

  it('rejects unknown and over-wide inputs', async () => {
    await openFixture()

    await assert.rejects(
      () => analyzeImpact({ paths: ['src/missing.ts'] }),
      /not an indexed project file/
    )
    await assert.rejects(() => analyzeImpact({ paths: [] }), /at least one/)
  })
})
