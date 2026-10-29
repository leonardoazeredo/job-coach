import type { Expectations } from './types.ts'

const CONTACT = [
  'sam@example.com',
  '+1 555 010 0199',
  'Springfield',
  'linkedin.com/in/',
  'github.com/',
]

// Used only when no --data file is supplied.
export const FALLBACK_EXPECTATIONS: Expectations = {
  email: CONTACT[0] ?? null,
  keywords: [
    'JavaScript',
    'TypeScript',
    'Java',
    'SQL',
    'HTML',
    'CSS',
    'REST APIs',
    'GraphQL',
    'PostgreSQL',
    'Git',
    'Linux',
    'observability',
    'CI/CD',
    'testing',
    'architecture',
    'performance',
    'accessibility',
    'mentoring',
    'collaboration',
  ],
  headings: ['SUMMARY', 'SKILLS', 'WORK EXPERIENCE', 'PROJECTS', 'LANGUAGES'],
  contact: CONTACT,
  pairs: [],
}
