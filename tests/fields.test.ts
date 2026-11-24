import { describe, expect, it } from 'vitest'
import { allFields, checkValue, fieldEditable, isValidTimezone, migrateTemplate, slugKey, templateAccount, templatePath } from '../src/shared/fields'
import type { Account, SlackFieldDef } from '../src/shared/types'

const schema: SlackFieldDef[] = [
  { id: 'PeB', section: 'Ps1', sectionLabel: 'About me', label: 'Birthday', hint: '', kind: 'date', editable: true, key: 'birthday' },
  { id: 'PeW', section: 'Ps1', sectionLabel: 'About me', label: 'Website', hint: '', kind: 'link', editable: true, key: 'website' },
  { id: 'PeS', section: 'Ps1', sectionLabel: 'About me', label: 'School', hint: '', kind: 'text', editable: true, key: 'school' },
  { id: 'PeM', section: 'Ps2', sectionLabel: 'People', label: 'Manager', hint: '', kind: 'person', editable: true, key: 'manager' },
  { id: 'PeG', section: 'Ps1', sectionLabel: 'About me', label: 'Hack Club Gold since', hint: '', kind: 'text', editable: false, key: 'gold_since' }
]
const FIELDS = allFields(schema)
const field = (key: string) => FIELDS.find((f) => f.key === key)!

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
    expect(checkValue(field('website_url'), 'http://fiona.dev')).toBe('')
    expect(checkValue(field('website_url'), 'fiona.dev')).toBe('Must start with https://')
  })
  it('checks people', () => {
    expect(checkValue(field('manager'), 'U0923H02Y3B')).toBe('')
    expect(checkValue(field('manager'), 'U1AB, W2CD')).toBe('')
    expect(checkValue(field('manager'), '@fiona')).toMatch(/Slack user IDs/)
  })
})

describe('Slack fields from Slack', () => {
  it('splits links into text and URL', () => {
    expect(field('website_text')).toMatchObject({ id: 'PeW.text', name: 'Website: display text', part: 'text' })
    expect(field('website_url')).toMatchObject({ id: 'PeW.url', kind: 'url', part: 'url' })
    expect(field('manager').kind).toBe('user')
  })
  it('makes template keys from labels', () => {
    expect(slugKey('Fav Food(s)', 'Pe1')).toBe('fav_food_s')
    expect(slugKey('🏆 Club Rank', 'Pe1')).toBe('club_rank')
    expect(slugKey('🎉', 'PeX1')).toBe('pex1')
    expect(slugKey('2nd school', 'Pe1')).toBe('f_2nd_school')
  })
  it('puts values in the template account', () => {
    const a = { localName: '', email: 'f@x.co', firstName: 'F', lastName: 'H', phone: '', slack: { linked: true, id: 'U1', session: true, profile: { title: 'Lead', 'PeW.url': 'https://f.dev', PeS: 'HHS' } } } as unknown as Account
    const t = templateAccount(a, FIELDS.filter((f) => f.slack))
    expect(t.slack).toMatchObject({ id: 'U1', title: 'Lead', fields: { website_url: 'https://f.dev', website_text: '', school: 'HHS', birthday: '' } })
  })
})

describe('fieldEditable', () => {
  it('allows everything but admin-only Slack fields', () => {
    expect(fieldEditable(field('first'))).toBe(true)
    expect(fieldEditable(field('display_name'))).toBe(true)
    expect(fieldEditable(field('school'))).toBe(true)
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
    expect(migrateTemplate('{{ account.title | default("x") }}')).toBe('{{ account.slack.title | default("x") }}')
    expect(migrateTemplate('{{ account.email }} {{ account.local }} {{ account.hca.first }} {{ account.slack.fields.school }}')).toBe(
      '{{ account.email }} {{ account.local }} {{ account.hca.first }} {{ account.slack.fields.school }}'
    )
  })
})
