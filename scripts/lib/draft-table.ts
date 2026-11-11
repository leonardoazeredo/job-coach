// One table per template a Draft is made from: every key the template holds, plus the keys a
// later step adds. A test holds each table and its template in step.
import { ROCKETSHIP_EMPLOYMENT, ROCKETSHIP_SENIORITY, searchNotes } from './boards/rocketship.ts'
import { CvDataSchema, HistoryFileSchema, WinsFileSchema } from './cv-schema.ts'
import {
  type DataTable,
  entries,
  group,
  isObj,
  items,
  later,
  list,
  noting,
  ofJobs,
  ofLevels,
  reading,
  ruled,
  type Shape,
  standingIn,
  type Table,
  value,
  wording,
} from './draft-fields.ts'
import { CURRENCY, EMPLOYMENT_TYPES, LOCALE, MONEY, oneOf, TIMEZONE } from './draft-rules.ts'
import { IdentitySchema } from './identity.ts'
import { masterRefusals, stackRefusals } from './never-claim.ts'
import { SearchSchema } from './schema.ts'
import { StackFileSchema } from './stack.ts'

const contact: Shape = {
  email: value('Email'),
  phone: value('Phone'),
  linkedin: value('LinkedIn'),
  github: value('GitHub'),
}

const identity: DataTable = {
  format: 'yaml',
  template: 'profile/identity.example.yaml',
  schema: IdentitySchema,
  root: group({
    name: value('Name'),
    ...contact,
    locale: ruled(reading(value('Locale'), 'locale'), LOCALE),
    competency_pack: later(reading(value('Competency pack', 'default'), 'pack')),
    location: group({
      city: value('City'),
      since: value('Living there since', 'sample', 'date'),
      timezone: ruled(value('Timezone'), TIMEZONE),
    }),
    right_to_work: entries('Right to work', '{key}: {value}'),
    availability: value('Availability'),
    languages: list('Languages'),
    experience_years: value('Years of experience'),
    seniority_targets: ofLevels(list('Target levels')),
    compensation: group({
      currency: ruled(reading(value('Currency'), 'currency'), CURRENCY),
      floor: ruled(reading(value('Lowest base pay'), 'money'), MONEY),
      by_level: entries(
        'Pay range by level',
        'At {key} level: {min} to {max}',
        {
          min: ruled(reading(value('Lowest'), 'money'), MONEY),
          max: ruled(reading(value('Highest'), 'money'), MONEY),
        },
        'levels',
      ),
    }),
    work_setup: group({
      office_days_ok: value('Office days a week'),
      remote: value('Open to remote work'),
    }),
    ideal_role_criteria: list('What a good role has'),
  }),
}

const tier = (n: number, when: 'sample' | 'default') =>
  group({
    label: value(`Priority ${n} name`, 'default'),
    when: value(`When a role is priority ${n}`, when),
    action: value(`What a priority ${n} role gets`, 'default'),
  })

const searchIn = (file: Record<string, unknown>) => {
  const { discovery } = file
  const found = isObj(discovery) ? discovery.search : undefined
  return isObj(found) ? found : {}
}

const search: DataTable = {
  format: 'yaml',
  template: 'profile/search.example.yaml',
  schema: SearchSchema,
  notes: (now, was) => searchNotes(searchIn(now), was && searchIn(was)),
  root: group({
    tiers: group({ 0: tier(0, 'sample'), 1: tier(1, 'sample'), 2: tier(2, 'default') }),
    fit: group({
      min_stack_overlap_pct: value('Least match with your skills, in percent', 'default'),
      location_rule: value('Where you can work'),
      hard_limits: list('Hard limits', 'default'),
    }),
    discovery: group({
      agentic_keywords: list('Words that flag an AI-heavy ad', 'default'),
      search_titles: list('Job titles searched'),
      title_expansion: list('Other titles that qualify'),
      field_terms: list('Words in a job title that show it is your kind of work'),
      excluded_words: list('Words in a job title that rule it out', 'default'),
      search: group({
        city: value('Search city'),
        country: value('Search country'),
        regions: list('Search regions'),
        seniority: ruled(ofLevels(list('Search levels')), oneOf(ROCKETSHIP_SENIORITY)),
        stack: list('Skills and tools searched'),
        employment: ruled(value('Employment searched'), oneOf(ROCKETSHIP_EMPLOYMENT)),
        hybrid: value('Include hybrid roles'),
      }),
    }),
  }),
}

// A string item is claimable without limit; an object item is limited to its roles.
const stackItems = (label: string) =>
  items(label, {
    id: 'name',
    frame: '{name}: write it as "{claim_as}"[, except in {roles}, where it may be written plainly]',
    fields: {
      name: value('Name', 'exempt'),
      roles: ofJobs(list('Jobs where it may be written plainly')),
      claim_as: value('How to write it everywhere else'),
    },
  })

const stack: DataTable = {
  format: 'yaml',
  template: 'profile/stack.example.yaml',
  schema: StackFileSchema,
  root: group({
    core: stackItems('Main skills and tools'),
    secondary: stackItems('Other skills and tools'),
    past: stackItems('Skills and tools from earlier jobs'),
    tools: stackItems('Tools'),
    do_not_claim: noting(
      list('Never claim', 'sample', {
        frame: '{item}; you say instead: {allowed_framing}',
        fields: {
          item: value('What you never claim'),
          allowed_framing: value('What you say instead'),
          patterns: list('Patterns that catch it', 'exempt'),
        },
      }),
      'The coach makes sure your CV never says any of these.',
    ),
    adaptability_framing: value('What you say when an ad asks for a skill you lack'),
  }),
  refuse: stackRefusals,
}

const history: DataTable = {
  format: 'yaml',
  template: 'profile/history.example.yaml',
  schema: HistoryFileSchema,
  root: group({
    roles: items('Jobs', {
      id: 'id',
      frame:
        '{public.title} at {company}, {public.start} to {public.end}, {public.employment_type}',
      fields: {
        id: value('Job id', 'exempt'),
        company: value('Company'),
        public: group({
          title: value('Title'),
          employment_type: ruled(value('Employment type'), oneOf(EMPLOYMENT_TYPES)),
          start: value('Start', 'sample', 'date'),
          end: value('End', 'sample', 'date'),
          location: value('Location'),
        }),
        summary: value('Summary'),
        experience_bank: later(value('Experience bank file', 'default')),
      },
    }),
  }),
}

// The template's keys are a suggestion, so a job here may hold others.
const historyPrivate: DataTable = {
  format: 'yaml',
  template: 'profile/history-private.example.yaml',
  root: group({
    roles: items('Private notes on jobs', {
      id: 'id',
      frame: '{id}[, payroll title {payroll_title}]',
      open: true,
      quiet: true,
      fields: {
        id: reading(value('Job id', 'exempt'), 'job'),
        // The template holds none of these, so a job with nothing private to say about one is
        // not asked about it.
        payroll_title: later(value('Payroll title', 'default')),
        why_it_ended: later(value('Why it ended', 'default')),
        background_check_risk: later(value('Background-check risk', 'default')),
        salary_history: later(value('Salary in this job', 'default')),
        notes: later(value('Notes', 'default')),
      },
    }),
  }),
}

const wins: DataTable = {
  format: 'yaml',
  template: 'profile/wins.example.yaml',
  schema: WinsFileSchema,
  root: group({
    wins: items('Achievements', {
      id: 'slug',
      frame: '{action}',
      fields: {
        slug: value('Slug', 'exempt'),
        role: reading(value('Job'), 'job'),
        status: wording(value('Approval', 'default'), {
          proposed: 'waiting for your yes',
          approved: 'approved',
        }),
        themes: list('Themes', 'exempt'),
        metric: standingIn(value('Figure', 'default'), 'no number yet'),
        action: value('What you did'),
        never_say: list('Never say', 'default'),
        competencies: list('Competencies', 'exempt'),
      },
    }),
  }),
}

// Forms differ, so answers beyond the template's are welcome.
const standardAnswers: DataTable = {
  format: 'yaml',
  template: 'profile/standard-answers.example.yaml',
  root: group(
    {
      work_authorization: value('Right to work'),
      sponsorship_required: value('Needs sponsorship'),
      based_in: value('Based in'),
      notice_period: value('Notice period'),
      earliest_start: value('Earliest start'),
      years_experience: value('Years of experience'),
      salary_expectation: entries('Salary expectation', '{key}: {value}', undefined, 'levels'),
      office_attendance: value('Office attendance'),
      employment_type: value('Employment type'),
      links: group({ linkedin: value('LinkedIn'), github: value('GitHub') }),
      career_gaps: value('Career gaps'),
    },
    'open',
  ),
}

const master: DataTable = {
  format: 'json',
  template: 'cv/master.example.json',
  schema: CvDataSchema,
  root: group({
    name: value('Name'),
    headline: value('Headline'),
    location: value('Location'),
    ...contact,
    summary: value('Summary'),
    skills: list('Skills'),
    work: items('Work', {
      id: 'id',
      frame: '{role} at {company}, {start} to {end}',
      fields: {
        id: value('Job id', 'exempt'),
        role: value('Title'),
        company: value('Company'),
        location: value('Location'),
        start: value('Start', 'sample', 'date'),
        end: value('End', 'sample', 'date'),
        note: later(value('Note', 'default')),
        tech: list('Skills and tools used'),
        bullets: list('Bullets'),
      },
    }),
    training: list('Training'),
    projects: list('Projects', 'default'),
    education: items('Education', {
      id: 'id',
      frame: '{degree}, {institution}, [{start} to ]{end}',
      fields: {
        id: value('Education id', 'exempt'),
        degree: value('Degree'),
        institution: value('Institution'),
        location: value('Location'),
        start: value('Start', 'sample', 'date'),
        end: value('End', 'sample', 'date'),
      },
    }),
    languages: list('Languages'),
  }),
  refuse: masterRefusals,
}

const text = (name: string): Table => ({ format: 'text', template: `profile/${name}.example.md` })

// Every file a Draft may be made of, by its path in the user's folder.
export const TABLES: Record<string, Table> = {
  'profile/identity.yaml': identity,
  'profile/search.yaml': search,
  'profile/stack.yaml': stack,
  'profile/history.yaml': history,
  'profile/history-private.yaml': historyPrivate,
  'profile/wins.yaml': wins,
  'profile/standard-answers.yaml': standardAnswers,
  'profile/coach.md': text('coach'),
  'profile/voice.md': text('voice'),
  'profile/lessons.md': text('lessons'),
  'profile/glossary.md': text('glossary'),
  'cv/master.json': master,
}
