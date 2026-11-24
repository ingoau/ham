import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { UnknownElementError, changedElements, expiryFromSlack, expiryToSlack, parseClientAuth, parseSections, referencedUsers, sectionElements, sectionsOf } from '../src/main/slack-profile'

// Shaped like users.profile.getSections on Hack Club Slack (2026-11), trimmed.
const sections = sectionsOf(JSON.parse(readFileSync(new URL('./fixtures/slack_sections.json', import.meta.url), 'utf8')))
const section = (id: string) => sections.find((s) => s.sectionId === id)!

describe('parseClientAuth', () => {
  const page = (teams: object) =>
    `<script>sessionStorage.incomingConfig = JSON.stringify(${JSON.stringify({ teams, lc: '1' })});\nlocation = "https:\\/\\/app.slack.com\\/client";</script>`

  it('prefers the enterprise token on the org host', () => {
    const html = page({
      E09V59WQY1E: { id: 'E09V59WQY1E', url: 'https://hackclub.enterprise.slack.com/', domain: 'hackclub', token: 'xoxc-org', user_id: 'U1' },
      T0266FRGM: { id: 'T0266FRGM', url: 'https://hackclub.slack.com/', domain: 'hackclub', token: 'xoxc-team', user_id: 'U1', enterprise_id: 'E09V59WQY1E', enterprise_api_token: 'xoxc-ent' }
    })
    expect(parseClientAuth(html)).toEqual({ token: 'xoxc-ent', api: 'https://hackclub.enterprise.slack.com/', userId: 'U1' })
  })
  it('falls back to the workspace token', () => {
    const html = page({ T0266FRGM: { id: 'T0266FRGM', url: 'https://hackclub.slack.com', domain: 'hackclub', token: 'xoxc-team', user_id: 'U1' } })
    expect(parseClientAuth(html)).toEqual({ token: 'xoxc-team', api: 'https://hackclub.slack.com/', userId: 'U1' })
  })
  it('is null when signed out or for other workspaces', () => {
    expect(parseClientAuth('<html>Sign in to Slack</html>')).toBeNull()
    expect(parseClientAuth(page({ T999: { id: 'T999', url: 'https://other.slack.com/', domain: 'other', token: 'x', user_id: 'U1' } }))).toBeNull()
  })
})

describe('parseSections', () => {
  const { fields, values } = parseSections(sections)

  it('lists the workspace fields HAM can show, by section', () => {
    expect(fields.map((f) => [f.sectionLabel, f.label, f.kind, f.key, f.editable])).toEqual([
      ['Header', 'Name Pronunciation', 'text', 'name_pronunciation', true],
      ['Contact information', 'Phone', 'text', 'phone', true],
      ['People', 'Manager', 'person', 'manager', true],
      ['About me', 'Start Date', 'date', 'start_date', true],
      ['About me', 'Website', 'link', 'website', true],
      ['About me', 'School', 'text', 'school', true],
      ['About me', 'Fav Food(s)', 'text', 'fav_food_s', true],
      ['About me', 'Hack Club Gold since', 'text', 'hack_club_gold_since', false]
    ])
  })
  it('reads values, with the title and both halves of links', () => {
    expect(values).toMatchObject({
      title: 'Club leader',
      PeMGR: 'U0MANAGER',
      PeSTART: '2025-12-13',
      'PeWEB.text': 'fiona.dev',
      'PeWEB.url': 'https://fiona.dev',
      PeFOOD: 'Dumplings',
      PeSCHOOL: ''
    })
    expect(values).not.toHaveProperty('PeEMAIL')
    expect(values).not.toHaveProperty('PeBSKY')
    expect(referencedUsers(fields, values)).toEqual(['U0MANAGER'])
  })
  it('keeps keys unique', () => {
    const twice = parseSections([{ sectionId: 'Ps1', label: 'A', profileElements: [section('PsABOUT').profileElements![2], { ...section('PsABOUT').profileElements![2], elementId: 'PeOTHER' }] }])
    expect(twice.fields.map((f) => f.key)).toEqual(['school', 'school_2'])
  })
})

describe('status expiry', () => {
  it('converts between Slack’s seconds and ISO times', () => {
    expect(expiryFromSlack(0)).toBe('')
    expect(expiryFromSlack(1795500000)).toBe('2026-11-24T06:00:00Z')
    expect(expiryToSlack('2026-11-24T06:00:00Z')).toBe(1795500000)
    expect(expiryToSlack('')).toBe(0)
    expect(expiryToSlack('soon')).toBe(0)
  })
})

describe('saving sections', () => {
  it('finds the elements a change touches', () => {
    expect([...changedElements(sections, { title: 'x', 'PeWEB.url': 'https://a.b', real_name: 'y' })].sort()).toEqual(['PeTITLE', 'PeWEB'])
  })
  it('sends the whole section like Slack’s form, empties as null', () => {
    expect(sectionElements(section('PsABOUT'), { PeSCHOOL: 'Hackworth High', 'PeWEB.url': '', PeSTART: '2026-01-02' })).toEqual([
      { element_id: 'PeSTART', date: { date: '2026-01-02' } },
      { element_id: 'PeWEB', link: null },
      { element_id: 'PeSCHOOL', text: { text: 'Hackworth High' } },
      { element_id: 'PeFOOD', text: { text: 'Dumplings' } },
      { element_id: 'PeGOLD', text: { text: '2025' } },
      { element_id: 'PeBLANK', text: null },
      { element_id: 'PeBSKY', link: null }
    ])
  })
  it('saves the title and keeps files in the header', () => {
    expect(sectionElements(section('PsHEAD'), { title: 'Organizer' })).toEqual([
      { element_id: 'PeTITLE', text: { text: 'Organizer' } },
      { element_id: 'PeREC', file: { fileId: 'F123' } },
      { element_id: 'PePRON', text: null }
    ])
  })
  it('tidies only the values being changed', () => {
    const sec = { sectionId: 'Ps1', profileElements: [
      { __typename: 'ProfileTextElement', elementId: 'Pe1', text: ' spaced ' },
      { __typename: 'ProfileTextElement', elementId: 'Pe2', text: 'x' }
    ] }
    expect(sectionElements(sec, { Pe2: '  new  ' })).toEqual([
      { element_id: 'Pe1', text: { text: ' spaced ' } },
      { element_id: 'Pe2', text: { text: 'new' } }
    ])
  })
  it('refuses to save a section with an element it would drop', () => {
    const sec = { sectionId: 'Ps1', profileElements: [{ __typename: 'ProfileMysteryElement', elementId: 'Pe9', label: 'Mystery' }] }
    expect(() => sectionElements(sec, {})).toThrow(UnknownElementError)
  })
  it('sends people as user ids', () => {
    expect(sectionElements(section('PsPEOPLE'), { PeMGR: 'U1, U2' })).toEqual([{ element_id: 'PeMGR', person: { persons: ['U1', 'U2'] } }])
    expect(sectionElements(section('PsPEOPLE'), { PeMGR: '' })).toEqual([{ element_id: 'PeMGR', person: { persons: [] } }])
    expect(sectionElements(section('PsPEOPLE'), {})).toEqual([{ element_id: 'PeMGR', person: { persons: ['U0MANAGER'] } }])
  })
})
