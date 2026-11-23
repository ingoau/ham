import { describe, expect, it } from 'vitest'
import { isNewer } from '../src/shared/version'

describe('isNewer', () => {
  it.each([
    ['0.2.0', '0.1.0', true],
    ['0.1.1', '0.1.0', true],
    ['1.0.0', '0.9.9', true],
    ['v0.1.0', '0.1.0', false],
    ['0.1.0', '0.1.0', false],
    ['0.0.9', '0.1.0', false],
    ['1.0.0', '1.0.0-beta.1', true],
    ['1.0.0-beta.2', '1.0.0-beta.1', true],
    ['1.0.0-beta.1', '1.0.0', false],
    ['0.10.0', '0.9.0', true]
  ])('%s newer than %s: %s', (a, b, expected) => {
    expect(isNewer(a, b)).toBe(expected)
  })
})
