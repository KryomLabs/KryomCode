'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { truncate, normalizeWhitespace, isBlank } = require('./text-utils.cjs');

describe('text-utils', () => {
  it('truncate returns short strings unchanged', () => {
    assert.equal(truncate('hello', 10), 'hello');
  });
  it('truncate shortens long strings with suffix', () => {
    const out = truncate('hello world', 5);
    assert.equal(out.length, 5);
    assert.ok(out.endsWith('…'));
  });
  it('truncate never throws on non-string', () => {
    assert.equal(truncate(null), '');
    assert.equal(truncate(undefined), '');
    assert.equal(truncate(123), '');
  });
  it('normalizeWhitespace collapses and trims', () => {
    assert.equal(normalizeWhitespace('  a   b\n c  '), 'a b c');
    assert.equal(normalizeWhitespace(null), '');
  });
  it('isBlank detects empty cases', () => {
    assert.equal(isBlank(''), true);
    assert.equal(isBlank('   '), true);
    assert.equal(isBlank(null), true);
    assert.equal(isBlank('x'), false);
  });
});
