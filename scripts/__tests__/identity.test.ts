import { describe, expect, it } from 'vitest'
import { pdfFileName } from '../lib/identity.ts'

describe('pdfFileName', () => {
  it('joins first and last name', () => {
    expect(pdfFileName('Dana Okafor')).toBe('Dana-Okafor-CV.pdf')
  })

  it('uses the first and last words of a longer name', () => {
    expect(pdfFileName('Ana Maria de Souza Lima')).toBe('Ana-Lima-CV.pdf')
  })

  it('strips accents and punctuation a filesystem or an upload form may refuse', () => {
    expect(pdfFileName('Zoë O’Brien-Müller')).toBe('Zoe-OBrien-Muller-CV.pdf')
  })

  it('handles a single name and surrounding space', () => {
    expect(pdfFileName('  Prince ')).toBe('Prince-CV.pdf')
  })

  it('falls back to a plain name when nothing usable is left', () => {
    expect(pdfFileName('')).toBe('CV.pdf')
  })
})
