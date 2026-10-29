// Finds candidate evidence for each requirement of a role: approved wins,
// answered experience-bank questions and stack.yaml entries. Scoring is a
// plain, explainable count; the cv-for-role skill reads the candidates and
// decides which evidence slots each one actually fills.

import type { Competencies, Competency, Requirement, Win } from './cv-schema.ts'
import { keywordHits } from './requirements.ts'
import type { BankQuestion, Sources } from './sources.ts'

export type Candidate = { ref: string; score: number; why: string[]; summary: string }
export type RequirementEvidence = {
  id: string
  quote: string
  kind: Requirement['kind']
  competency: string | undefined
  candidates: Candidate[]
  stack: { matched: string[]; missing: string[] } | undefined
}

// Wins and bank answers are capped separately so one kind cannot crowd out the other.
const MAX_WINS = 5
const MAX_QUESTIONS = 10

type Scored = { score: number; why: string[] }

const scoreWin = (win: Win, r: Requirement, competency: Competency | undefined): Scored => {
  const themes = new Set(competency?.win_themes ?? [])
  const why: string[] = []
  let score = 0
  if (competency && win.competencies.includes(competency.id)) {
    score += 3
    why.push(`competency ${competency.id}`)
  } else if (win.themes.some((t) => themes.has(t))) {
    score += 2
    why.push(`theme ${win.themes.filter((t) => themes.has(t)).join(', ')}`)
  }
  const hits = keywordHits(`${win.action} ${win.metric}`, r.keywords)
  if (hits.length) why.push(`keywords ${hits.join(', ')}`)
  return { score: score + hits.length, why }
}

const scoreQuestion = (
  q: BankQuestion,
  r: Requirement,
  competency: Competency | undefined,
): Scored => {
  const themes = new Set(competency?.win_themes ?? [])
  const why: string[] = []
  let score = 0
  if (competency && q.tags.includes(competency.id)) {
    score += 3
    why.push(`tag ${competency.id}`)
  } else if (q.tags.some((t) => themes.has(t))) {
    score += 1
    why.push(`theme tag ${q.tags.filter((t) => themes.has(t)).join(', ')}`)
  }
  const hits = keywordHits(q.text, r.keywords)
  if (hits.length) why.push(`keywords ${hits.join(', ')}`)
  return { score: score + hits.length, why }
}

const scoreRequirement = (
  r: Requirement,
  sources: Sources,
  competencies: Competencies,
): Candidate[] => {
  const competency = competencies.competencies.find((c) => c.id === r.competency)
  // Only citables are offered, so a candidate never fails on a missing or unapproved source.
  const wins = sources
    .citable('win')
    .map(({ ref, win }) => ({ ref, summary: win.action, ...scoreWin(win, r, competency) }))
  const questions = sources.citable('bank').map(({ ref, question }) => ({
    ref,
    summary: question.summary,
    ...scoreQuestion(question, r, competency),
  }))
  const top = (list: Candidate[], max: number) =>
    list
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score || a.ref.localeCompare(b.ref))
      .slice(0, max)
  return [...top(wins, MAX_WINS), ...top(questions, MAX_QUESTIONS)]
}

export const findEvidence = (
  searched: Requirement[],
  sources: Sources,
  competencies: Competencies,
): RequirementEvidence[] =>
  searched.map((r) => ({
    id: r.id,
    quote: r.quote,
    kind: r.kind,
    competency: r.competency,
    candidates: scoreRequirement(r, sources, competencies),
    stack:
      r.kind === 'technology'
        ? {
            matched: r.keywords.filter((k) => sources.stack.covers(k)),
            missing: r.keywords.filter((k) => !sources.stack.covers(k)),
          }
        : undefined,
  }))
