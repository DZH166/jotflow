import assert from 'node:assert/strict'
import test from 'node:test'

import { buildArchiveFilename, formatFailure } from '../capture-utils.js'

test('buildArchiveFilename removes Windows-reserved characters', () => {
  const filename = buildArchiveFilename('A <page>: title?', new Date('2026-08-11T12:00:00.000Z'))

  assert.equal(filename, '小董随心录/2026-08-11-A page title.mhtml')
})

test('buildArchiveFilename falls back to a readable name', () => {
  const filename = buildArchiveFilename('  ', new Date('2026-08-11T12:00:00.000Z'))

  assert.equal(filename, '小董随心录/2026-08-11-untitled-page.mhtml')
})

test('formatFailure keeps browser error messages useful', () => {
  assert.equal(formatFailure(new Error('Browser blocked this page.')), 'Browser blocked this page.')
})
