const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const {
  extractKeywords,
  derivePlanExtractive,
  parsePlanJson,
  buildPlanningPrompt,
  planResearch,
} = require('./planner.cjs')
const { getProfile } = require('./depth-profiles.cjs')

describe('research planner', () => {
  it('extracts distinctive keywords without stopwords', () => {
    const keywords = extractKeywords('How can small AI models improve autonomous coding agents?')

    assert.ok(keywords.includes('small'))
    assert.ok(keywords.includes('models'))
    assert.ok(keywords.includes('autonomous') || keywords.includes('coding') || keywords.includes('agents'))
    assert.ok(!keywords.includes('how'))
    assert.ok(!keywords.includes('can'))
  })

  it('derives a bounded extractive plan from the objective itself', () => {
    const profile = getProfile('standard')
    const plan = derivePlanExtractive('Quantum error correction with surface codes', profile)

    assert.equal(plan.subQuestions.length, 4)
    assert.deepEqual(plan.subQuestions.map((entry) => entry.id), ['q1', 'q2', 'q3', 'q4'])
    assert.ok(plan.subQuestions.every((entry) => entry.status === 'pending'))
    assert.ok(plan.subQuestions.every((entry) => entry.queries.length >= 1 && entry.queries.length <= profile.queriesPerQuestion))
    assert.ok(plan.subQuestions.every((entry) => entry.queries[0].startsWith('Quantum error correction')))
    assert.match(plan.subQuestions[0].queries[0], /Quantum error correction/)
    assert.ok(plan.searchTerms.includes('quantum'))
    assert.ok(plan.evidenceNeeds.length > 0)
    assert.match(plan.via, /extractive/)
  })

  it('scales question counts with depth', () => {
    const quick = derivePlanExtractive('Some topic with enough words to plan', getProfile('quick'))
    const deep = derivePlanExtractive('Some topic with enough words to plan', getProfile('deep'))

    assert.equal(quick.subQuestions.length, 2)
    assert.equal(deep.subQuestions.length, 6)
  })

  it('flags short or vague objectives honestly', () => {
    const plan = derivePlanExtractive('AI?', getProfile('standard'))

    assert.ok(plan.ambiguityNotes.length > 0)
    assert.ok(plan.subQuestions.length > 0)
  })

  it('parses and bounds LLM plans strictly', () => {
    const raw = JSON.stringify({
      subQuestions: [
        { text: 'First custom question?', queries: ['custom query one', 'custom query two', 'custom query three'] },
        'Second custom question?',
      ],
      searchTerms: ['custom', 'terms'],
      evidenceNeeds: ['Need evidence.'],
      ambiguityNotes: [],
    })
    const plan = parsePlanJson(raw, getProfile('standard'))

    assert.equal(plan.subQuestions.length, 2)
    assert.equal(plan.subQuestions[0].text, 'First custom question?')
    assert.ok(plan.subQuestions[0].queries.length <= getProfile('standard').queriesPerQuestion)
    assert.equal(plan.subQuestions[1].text, 'Second custom question?')
    assert.match(plan.via, /llm/)
  })

  it('rejects malformed LLM plans', () => {
    const profile = getProfile('standard')

    assert.throws(() => parsePlanJson('not json', profile), /not valid JSON/)
    assert.throws(() => parsePlanJson('[]', profile), /unexpected shape/)
    assert.throws(() => parsePlanJson('{}', profile), /no sub-questions/)
    assert.throws(
      () => parsePlanJson(JSON.stringify({ subQuestions: [{ text: '  ' }] }), profile),
      /empty/
    )
  })

  it('builds a JSON-only planning prompt naming the limits', () => {
    const prompt = buildPlanningPrompt('Test objective', getProfile('quick'))

    assert.match(prompt, /ONLY a JSON object/)
    assert.match(prompt, /at most 2 sub-questions/)
    assert.match(prompt, /never invent facts/)
    assert.match(prompt, /Test objective/)
  })

  it('plans through the LLM when chat succeeds', async () => {
    const llmChat = async () => JSON.stringify({
      subQuestions: [{ text: 'LLM-planned question?' }],
      searchTerms: ['llm'],
      evidenceNeeds: [],
      ambiguityNotes: ['Mild ambiguity noted.'],
    })
    const plan = await planResearch('LLM planning objective', { depth: 'quick', llmChat })

    assert.equal(plan.subQuestions.length, 1)
    assert.equal(plan.subQuestions[0].text, 'LLM-planned question?')
    assert.deepEqual(plan.ambiguityNotes, ['Mild ambiguity noted.'])
    assert.match(plan.via, /llm/)
  })

  it('falls back to extractive planning when the LLM fails', async () => {
    const failing = async () => { throw new Error('provider down') }
    const plan = await planResearch('Fallback planning objective', { depth: 'standard', llmChat: failing })

    assert.equal(plan.subQuestions.length, 4)
    assert.match(plan.via, /failed/)
    assert.match(plan.ambiguityNotes.join(' '), /provider down/)
  })

  it('falls back when the LLM returns malformed JSON', async () => {
    const garbled = async () => 'Sure, here is your plan...'
    const plan = await planResearch('Garbled planning objective', { depth: 'standard', llmChat: garbled })

    assert.equal(plan.subQuestions.length, 4)
    assert.match(plan.via, /extractive/)
  })

  it('requires an objective', async () => {
    await assert.rejects(planResearch('   ', { depth: 'standard' }), /objective is required/)
  })
})
