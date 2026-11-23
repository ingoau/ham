import { describe, expect, it } from 'vitest'
import { ALL_FIELDS, checkValue, fieldEditable, isValidTimezone, migrateTemplate, templatePath } from '../src/shared/fields'

const field = (id: string) => ALL_FIELDS.find((f) => f.id === id)!

describe('checkValue', () => {
  it('requires names', () => {
    expect(checkValue(field('first'), '  ')).toBe("Can't be blank")
    expect(checkValue(field('first'), 'Fiona')).toBe('')
    expect(checkValue(field('phone'), '')).toBe('')
  })
  it('checks dates', () => {
    expect(checkValue(field('birthday'), '2008-02-29')).toBe('')
    expect(checkValue(field('birthday'), '29/02/2008')).toBe('Use YYYY-MM-DD')
  })
  it('checks timezones', () => {
    expect(checkValue(field('tz'), 'Australia/Sydney')).toBe('')
    expect(checkValue(field('tz'), 'Mars/Olympus')).toBe('Unknown timezone')
    expect(isValidTimezone('UTC')).toBe(true)
  })
  it('checks emoji and URLs', () => {
    expect(checkValue(field('status_emoji'), ':ham:')).toBe('')
    expect(checkValue(field('status_emoji'), 'ham')).toBe('Use :emoji_name:')
    expect(checkValue(field('website_url'), 'https://fiona.dev')).toBe('')
    expect(checkValue(field('website_url'), 'http://fiona.dev')).toBe('Must start with https://')
  })
})

describe('fieldEditable', () => {
  it('allows HCA fields now, Slack fields once the integration lands', () => {
    expect(fieldEditable(field('first'))).toBe(true)
    expect(fieldEditable(field('display_name'))).toBe(false)
    expect(fieldEditable(field('gold_since'))).toBe(false)
  })
})

describe('template paths', () => {
  it('nests fields by group', () => {
    expect(templatePath(field('local'))).toBe('local')
    expect(templatePath(field('first'))).toBe('hca.first')
    expect(templatePath(field('title'))).toBe('slack.title')
    expect(templatePath(field('school'))).toBe('slack.fields.school')
  })
  it('migrates old flat templates', () => {
    expect(migrateTemplate('{{ account.first }} {{ account.last }}')).toBe('{{ account.hca.first }} {{ account.hca.last }}')
    expect(migrateTemplate('{{ account.title | default("x") }} {{ account.school }}')).toBe(
      '{{ account.slack.title | default("x") }} {{ account.slack.fields.school }}'
    )
    expect(migrateTemplate('{{ account.email }} {{ account.local }} {{ account.hca.first }} {{ account.slack.fields.school }}')).toBe(
      '{{ account.email }} {{ account.local }} {{ account.hca.first }} {{ account.slack.fields.school }}'
    )
  })
})
