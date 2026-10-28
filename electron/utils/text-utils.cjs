'use strict';

/**
 * Small, safe text helpers for UI labels, logs, and status messages.
 * Pure functions with no dependencies and no side effects.
 * @module text-utils
 */

/**
 * Safely truncate a value to a max display length.
 * Never throws; non-string values return '' unless allowNonString is used.
 * @param {unknown} input
 * @param {number} [maxLength=200]
 * @param {string} [suffix='…']
 * @returns {string}
 */
function truncate(input, maxLength = 200, suffix = '…') {
  if (typeof input !== 'string') return '';
  const max = Number.isInteger(maxLength) && maxLength > 0 ? maxLength : 200;
  const end = typeof suffix === 'string' ? suffix : '…';
  if (input.length <= max) return input;
  if (max <= end.length) return end.slice(0, max);
  return input.slice(0, max - end.length) + end;
}

/**
 * Collapse whitespace and trim. Never throws.
 * @param {unknown} input
 * @returns {string}
 */
function normalizeWhitespace(input) {
  if (typeof input !== 'string') return '';
  return input.replace(/\s+/g, ' ').trim();
}

/**
 * True for undefined, null, non-string, empty or whitespace-only.
 * @param {unknown} input
 * @returns {boolean}
 */
function isBlank(input) {
  if (typeof input !== 'string') return true;
  return input.trim().length === 0;
}

module.exports = { truncate, normalizeWhitespace, isBlank };
