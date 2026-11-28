// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CommandPalette, MAX_ACCOUNT_RESULTS, matchAccounts } from '../../src/renderer/src/components/CommandPalette'
import { acct } from './helpers'

describe('matchAccounts', () => {
  it('caps the accounts shown and counts the rest', () => {
    const list = Array.from({ length: MAX_ACCOUNT_RESULTS + 30 }, () => acct())
    const { shown, more } = matchAccounts(list, [], '')
    expect(shown).toHaveLength(MAX_ACCOUNT_RESULTS)
    expect(more).toBe(30)
  })
  it('keeps only matches, best first', () => {
    const sam = acct({ firstName: 'Sam', lastName: 'Rivera' })
    const other = acct({ firstName: 'Fiona', lastName: 'Hackworth' })
    const sami = acct({ firstName: 'Samira', lastName: 'Q' })
    const { shown, more } = matchAccounts([other, sami, sam], [], 'sam rivera')
    expect(shown.map((x) => x.account.id)).toEqual([sam.id])
    expect(more).toBe(0)
  })
  it('matches tag names', () => {
    const a = acct({ tagIds: ['t1'] })
    const b = acct()
    const tags = [{ id: 't1', name: 'Alts', color: 'red' as const }]
    expect(matchAccounts([a, b], tags, 'alts').shown.map((x) => x.account.id)).toEqual([a.id])
  })
})

describe('CommandPalette', () => {
  afterEach(cleanup)

  it('renders a capped list that narrows as you type', () => {
    const list = Array.from({ length: 300 }, () => acct())
    const target = list[250]
    render(
      <CommandPalette open onOpenChange={() => {}} accounts={list} tags={[]} selectedId={null} mod="Ctrl+" onSelectAccount={vi.fn()} onAction={vi.fn()} />
    )
    expect(document.querySelectorAll('[cmdk-item][data-value^="account"]')).toHaveLength(MAX_ACCOUNT_RESULTS)
    expect(screen.getByText(`${300 - MAX_ACCOUNT_RESULTS} more`)).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText('Search accounts and actions…'), { target: { value: target.email } })
    expect(screen.getByText(target.email)).toBeTruthy()
  })
})
