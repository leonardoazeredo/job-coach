import { describe, expect, it } from 'vitest'
import {
  entries,
  fieldIn,
  group,
  groupOf,
  idOf,
  items,
  labelAt,
  list,
  value,
} from '../lib/draft-fields.ts'

const job = items('Jobs', {
  id: 'id',
  frame: '{id}',
  fields: { id: value('Id'), title: value('Title') },
})
const root = group({ name: value('Name'), jobs: job, notes: list('Notes') })

describe('groupOf', () => {
  it('reads the item fields of an items field', () => {
    expect(groupOf(job)).toEqual(group(job.fields))
  })

  it('keeps open on the item group of an open items field', () => {
    const open = items('Jobs', { id: 'id', frame: '{id}', fields: { id: value('Id') }, open: true })
    expect(groupOf(open)).toEqual(group(open.fields, 'open'))
  })

  it('reads the value fields of an entries field', () => {
    const shape = { years: value('Years') }
    expect(groupOf(entries('Levels', '{key}', shape))).toEqual(group(shape))
  })

  it('gives nothing for an entries field with no value shape', () => {
    expect(groupOf(entries('Levels', '{key}: {value}'))).toBeUndefined()
  })

  it('reads the item fields of a list whose items have fields', () => {
    const shape = { what: value('What') }
    expect(groupOf(list('Things', 'sample', { frame: '{what}', fields: shape }))).toEqual(
      group(shape),
    )
  })

  it('gives nothing for a list of plain entries, a value or a group', () => {
    expect(groupOf(list('Notes'))).toBeUndefined()
    expect(groupOf(value('Name'))).toBeUndefined()
    expect(groupOf(root)).toBeUndefined()
  })
})

describe('fieldIn', () => {
  it('gives the field the table names', () => {
    expect(fieldIn(root.fields, 'name')).toBe(root.fields.name)
  })

  it('reads a key the table does not name as a plain value labelled by the key', () => {
    expect(fieldIn(root.fields, 'right_to_work')).toEqual(value('right to work', 'default'))
  })
})

describe('idOf', () => {
  it('takes a string item as its own id', () => {
    expect(idOf(job, 'acme')).toBe('acme')
  })

  it('takes the id key of an object item', () => {
    expect(idOf(job, { id: 'acme', title: 'Engineer' })).toBe('acme')
    expect(idOf(job, { title: 'Engineer' })).toBeUndefined()
  })

  it('gives nothing for anything else', () => {
    expect(idOf(job, 7)).toBeUndefined()
    expect(idOf(job, null)).toBeUndefined()
    expect(idOf(job, ['acme'])).toBeUndefined()
  })
})

describe('labelAt', () => {
  const data = { name: 'Ada', jobs: [{ id: 'acme', title: 'Engineer' }, 'solo'] }

  it('names a top-level key by its label', () => {
    expect(labelAt(root, ['name'], data)).toBe('"Name"')
  })

  it('names a key inside an item with the item and its list', () => {
    expect(labelAt(root, ['jobs', 0, 'title'], data)).toBe('"Title" (acme in Jobs)')
  })

  it('names a string item by itself', () => {
    expect(labelAt(root, ['jobs', 1], data)).toBe('"Jobs" (solo in Jobs)')
  })

  it('names a key the table does not name by the key as words', () => {
    expect(labelAt(root, ['right_to_work'], data)).toBe('"right to work"')
  })
})
