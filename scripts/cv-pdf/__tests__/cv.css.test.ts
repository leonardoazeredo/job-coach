import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'vitest'

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '')
const cv = strip(readFileSync(new URL('../cv.css', import.meta.url), 'utf8'))

// Innermost rules only: a nested @media block yields its child rules, not itself.
function rules(css: string): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  for (let m = re.exec(css); m; m = re.exec(css)) {
    out.push({ selector: m[1].trim(), body: m[2] })
  }
  return out
}

function declarations(body: string): [string, string][] {
  const out: [string, string][] = []
  const re = /([a-z-]+)\s*:\s*([^;]+);/g
  for (let m = re.exec(body); m; m = re.exec(body)) {
    out.push([m[1], m[2].trim()])
  }
  return out
}

function ruleFor(selector: string): string {
  return rules(cv).find((r) => r.selector === selector)?.body ?? ''
}

function rootVar(name: string): number {
  const m = new RegExp(`${name}:\\s*([\\d.]+)px`).exec(ruleFor(':root'))
  assert.ok(m, `${name} missing from :root`)
  return Number(m[1])
}

function withoutScreenBlocks(css: string): string {
  let out = css
  for (;;) {
    const m = /@media screen\s*\{/.exec(out)
    if (!m) return out
    let depth = 0
    let end = out.length
    for (let i = m.index; i < out.length; i++) {
      if (out[i] === '{') depth++
      if (out[i] === '}' && --depth === 0) {
        end = i + 1
        break
      }
    }
    out = out.slice(0, m.index) + out.slice(end)
  }
}

test('font sizes scale', () => {
  for (const r of rules(cv)) {
    if (r.selector === 'body') continue
    for (const [prop, v] of declarations(r.body)) {
      if (prop !== 'font-size') continue
      assert.match(v, /^(var\(--cv-font\)|[\d.]+em)$/, `${r.selector} font-size: ${v}`)
    }
  }
})

test('no px spacing inside the cv', () => {
  for (const r of rules(cv)) {
    // .cv carries the screen sheet's own margin and padding; @page margins
    // are the printer's, covered by "one @page rule".
    if (r.selector === '.cv' || r.selector.startsWith('@page')) continue
    for (const [prop, v] of declarations(r.body)) {
      if (!/^(margin|padding)(-[a-z]+)?$/.test(prop)) continue
      const px = v.match(/-?[\d.]+px/g) ?? []
      for (const p of px) {
        assert.equal(Number.parseFloat(p), 0, `${r.selector} ${prop}: ${v}`)
      }
    }
  }
})

test('ATS rules survive', () => {
  assert.doesNotMatch(cv, /letter-spacing/)
  assert.doesNotMatch(cv, /display:\s*flex/)
  assert.doesNotMatch(cv, /display:\s*grid/)
  assert.doesNotMatch(cv, /system-ui/)
})

test('columns are screen-only', () => {
  assert.doesNotMatch(withoutScreenBlocks(cv), /(^|[\s;{])column[a-z-]*\s*:/)
})

test('one @page rule', () => {
  const pages = cv.match(/@page\b[^{]*\{[^}]*\}/g) ?? []
  assert.equal(pages.length, 1, `found ${pages.length} @page rules`)
  const margin = /margin:\s*([^;]+);/.exec(pages[0])?.[1].trim()
  assert.equal(margin, '48px 0')
  assert.equal(margin, `${rootVar('--page-margin-y')}px 0`)
})

test('geometry adds up', () => {
  assert.equal(rootVar('--cv-content-w') + 2 * rootVar('--page-margin-x'), rootVar('--page-w'))
})

test('headings keep their content', () => {
  assert.match(ruleFor('.cv-section h2'), /break-after:\s*avoid/)
  assert.match(ruleFor('.job'), /break-inside:\s*avoid/)
})

test('ligatures are off', () => {
  const body = ruleFor('.cv')
  assert.match(body, /font-variant-ligatures:\s*none/)
  assert.match(body, /font-feature-settings:\s*"liga" 0,\s*"clig" 0,\s*"dlig" 0/)
})
