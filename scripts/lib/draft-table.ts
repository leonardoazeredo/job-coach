// One table per template a Draft is made from: every key the template holds, plus the keys a
// later step adds. A test holds each table and its template in step.
import { CvDataSchema, HistoryFileSchema, WinsFileSchema } from './cv-schema.ts'
import {
  type DataTable,
  entries,
  group,
  items,
  later,
  list,
  type Shape,
  type Table,
  value,
} from './draft-fields.ts'
import { IdentitySchema } from './identity.ts'
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
    locale: value('Locale'),
    competency_pack: later(value('Competency pack', 'default')),
    location: group({
      city: value('City'),
      since: value('Living there since', 'sample', 'date'),
      timezone: value('Timezone'),
    }),
    right_to_work: entries('Right to work', '{key}: {value}'),
    availability: value('Availability'),
    languages: list('Languages'),
    experience_years: value('Years of experience'),
    seniority_targets: list('Target levels'),
    compensation: group({
      currency: value('Currency'),
      floor: value('Lowest base pay'),
      by_level: entries('Pay range by level', '{key}: {min} to {max}', {
        min: value('Lowest'),
        max: value('Highest'),
      }),
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
    label: value(`Tier ${n} name`, 'exempt'),
    when: value(`When a role is tier ${n}`, when),
    action: value(`What a tier ${n} role gets`, 'default'),
  })

const search: DataTable = {
  format: 'yaml',
  template: 'profile/search.example.yaml',
  schema: SearchSchema,
  root: group({
    tiers: group({ 0: tier(0, 'sample'), 1: tier(1, 'sample'), 2: tier(2, 'default') }),
    fit: group({
      min_stack_overlap_pct: value('Least stack overlap, in percent', 'default'),
      location_rule: value('Where you can work'),
      hard_limits: list('Hard limits', 'default'),
    }),
    discovery: group({
      agentic_keywords: list('Words that flag an AI-heavy ad', 'default'),
      search_titles: list('Job titles searched'),
      title_expansion: list('Other titles that qualify'),
      search: group({
        city: value('Search city'),
        country: value('Search country'),
        regions: list('Search regions'),
        seniority: list('Search levels'),
        stack: list('Search technologies'),
        employment: value('Employment searched'),
        hybrid: value('Include hybrid roles'),
      }),
    }),
  }),
}

// A string item is claimable without limit; an object item is limited to its roles.
const stackItems = (label: string) =>
  items(label, {
    id: 'name',
    frame: '{name}, written "{claim_as}"[ except at {roles}]',
    fields: {
      name: value('Name', 'exempt'),
      roles: list('Jobs where it may appear bare'),
      claim_as: value('How to write it elsewhere'),
    },
  })

const stack: DataTable = {
  format: 'yaml',
  template: 'profile/stack.example.yaml',
  schema: StackFileSchema,
  root: group({
    core: stackItems('Core stack'),
    secondary: stackItems('Secondary stack'),
    past: stackItems('Past stack'),
    tools: stackItems('Tools'),
    do_not_claim: list('Never claim', 'sample', {
      frame: '{item}; say instead: {allowed_framing}',
      fields: {
        item: value('What is never claimed'),
        allowed_framing: value('What to say instead'),
        patterns: list('Patterns that catch it'),
      },
    }),
    adaptability_framing: value('When an ad asks for something you lack'),
  }),
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
          employment_type: value('Employment type'),
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
      frame: 'Private notes[, payroll title {payroll_title}]',
      open: true,
      fields: {
        id: value('Job id', 'exempt'),
        payroll_title: value('Payroll title'),
        why_it_ended: value('Why it ended'),
        background_check_risk: value('Background-check risk'),
        salary_history: value('Salary in this job'),
        notes: value('Notes'),
      },
    }),
  }),
}

const wins: DataTable = {
  format: 'yaml',
  template: 'profile/wins.example.yaml',
  schema: WinsFileSchema,
  root: group({
    wins: items('Wins', {
      id: 'slug',
      frame: '{action} Result: {metric}',
      fields: {
        slug: value('Slug', 'exempt'),
        role: value('Job', 'exempt'),
        status: value('Status', 'default'),
        themes: list('Themes', 'exempt'),
        metric: value('Metric', 'default'),
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
      salary_expectation: entries('Salary expectation', '{key}: {value}'),
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
        note: value('Note'),
        tech: list('Technologies'),
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
