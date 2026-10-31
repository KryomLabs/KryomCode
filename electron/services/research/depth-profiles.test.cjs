const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const {
  DEPTHS,
  DEFAULT_DEPTH,
  PROFILES,
  resolveDepth,
  getProfile,
} = require('./depth-profiles.cjs')

describe('research depth profiles', () => {
  it('exposes quick, standard, and deep profiles', () => {
    assert.deepEqual(DEPTHS, ['quick', 'standard', 'deep'])
    assert.equal(DEFAULT_DEPTH, 'standard')

    for (const depth of DEPTHS) {
      const profile = getProfile(depth)

      assert.equal(profile.depth, depth)
      assert.ok(profile.maxQuestions >= 1)
      assert.ok(profile.queriesPerQuestion >= 1)
      assert.ok(profile.resultsPerQuery >= 1)
      assert.ok(profile.maxSources >= 1)
      assert.ok(profile.maxPageReads >= 1)
      assert.ok(profile.concurrency >= 1)
      assert.equal(typeof profile.verifyClaims, 'boolean')
      assert.equal(typeof profile.refineQueries, 'boolean')
    }
  })

  it('scales execution behavior with depth', () => {
    const quick = getProfile('quick')
    const standard = getProfile('standard')
    const deep = getProfile('deep')

    assert.ok(quick.maxQuestions < standard.maxQuestions)
    assert.ok(standard.maxQuestions < deep.maxQuestions)
    assert.ok(quick.maxSources < standard.maxSources)
    assert.ok(standard.maxSources < deep.maxSources)
    assert.equal(quick.verifyClaims, false)
    assert.equal(standard.verifyClaims, true)
    assert.equal(deep.verifyClaims, true)
    assert.equal(quick.refineQueries, false)
    assert.equal(deep.refineQueries, true)
  })

  it('defaults to standard and rejects unknown depths', () => {
    assert.equal(resolveDepth(undefined), 'standard')
    assert.equal(resolveDepth(null), 'standard')
    assert.equal(resolveDepth(''), 'standard')
    assert.equal(resolveDepth('deep'), 'deep')

    assert.throws(() => resolveDepth('ultra'), /Invalid depth/)
    assert.throws(() => resolveDepth(42), /Invalid depth/)
  })

  it('returns copies so callers cannot mutate the registry', () => {
    const first = getProfile('quick')

    first.maxSources = 9999

    assert.notEqual(getProfile('quick').maxSources, 9999)
    assert.equal(PROFILES.quick.maxSources, 8)
  })
})
