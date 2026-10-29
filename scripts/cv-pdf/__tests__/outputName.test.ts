import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { outputName } from '../outputName.ts'

describe('outputName', () => {
  it('slugifies the CV name', () => {
    assert.equal(outputName({ name: 'Alex Example' }), 'alex-example-CV.pdf')
  })

  it('strips diacritics', () => {
    assert.equal(outputName({ name: 'José Álvarez' }), 'jose-alvarez-CV.pdf')
  })

  it('falls back to cv.pdf when nothing usable is left', () => {
    assert.equal(outputName({ name: '  ' }), 'cv.pdf')
    assert.equal(outputName({ name: '—' }), 'cv.pdf')
  })
})
