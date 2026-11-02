import type { Expectations } from './types.ts'

const EMAIL = 'sam@example.com'

const CONTACT = [EMAIL, '+1 555 010 0199', 'Springfield', 'linkedin.com/in/', 'github.com/']

// Used only when no --data file is supplied.
export const FALLBACK_EXPECTATIONS: Expectations = {
  email: EMAIL,
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
