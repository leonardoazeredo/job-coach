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

  it.each([
    ['Łukasz Nowak', 'Lukasz-Nowak-CV.pdf'],
    ['Søren Aaberg', 'Soren-Aaberg-CV.pdf'],
    ['Ærin Ølsen', 'AErin-Olsen-CV.pdf'],
    ['Œdipe Moreau', 'OEdipe-Moreau-CV.pdf'],
    ['Strauß Weiß', 'Strauss-Weiss-CV.pdf'],
    ['Đorđe Đurić', 'Dorde-Duric-CV.pdf'],
    ['Ðór Þórsson', 'Dor-THorsson-CV.pdf'],
    ['Ismaıl Kaya', 'Ismail-Kaya-CV.pdf'],
    ['łukasz søren', 'lukasz-soren-CV.pdf'],
    ['æon œuvre', 'aeon-oeuvre-CV.pdf'],
    ['đorđe ðór', 'dorde-dor-CV.pdf'],
    ['þór ınan', 'thor-inan-CV.pdf'],
  ])('transliterates letters with no accent decomposition: %s', (name, file) => {
    expect(pdfFileName(name)).toBe(file)
  })

  it('keeps the CV.pdf fallback for a name with no Latin letters', () => {
    expect(pdfFileName('李 雷')).toBe('CV.pdf')
  })
})
