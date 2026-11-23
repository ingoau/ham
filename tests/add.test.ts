import { describe, expect, it, vi } from 'vitest'

vi.mock('@radix-ui/react-dialog', () => ({}))
vi.mock('lucide-react', () => ({}))
const { parseEmailList } = await import('../src/renderer/src/components/AddAccountsDialog')

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
