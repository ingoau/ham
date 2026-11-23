import { describe, expect, it } from 'vitest'
import { parseEmailList } from '../src/renderer/src/emails'

describe('parseEmailList', () => {
  it('splits on newlines, commas and semicolons', () => {
    expect(parseEmailList('A@example.com, b@example.com;c@example.com\n\nnot-an-email\n d@example.org ')).toEqual([
      'a@example.com',
      'b@example.com',
      'c@example.com',
      'd@example.org'
    ])
  })
})
