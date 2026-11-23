import { describe, expect, it } from 'vitest'
import { ALL_FIELDS, checkValue, fieldEditable, isValidTimezone } from '../src/shared/fields'

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
