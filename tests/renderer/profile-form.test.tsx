// @vitest-environment happy-dom
import { createRef } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProfileForm, type ProfileFormHandle } from '../../src/renderer/src/components/ProfileForm'
import { acct, mockHam } from './helpers'

const value = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value
const type = (label: string, text: string) => fireEvent.change(screen.getByLabelText(label), { target: { value: text } })

describe('ProfileForm', () => {
  beforeEach(() => {
    mockHam()
  })
  afterEach(cleanup)

  it('is dirty after an edit and clean after Revert', () => {
    const ref = createRef<ProfileFormHandle>()
    const a = acct({ firstName: 'Ann', lastName: 'Lee' })
    render(<ProfileForm ref={ref} account={a} onSaved={() => {}} />)
    expect(ref.current!.isDirty()).toBe(false)
    type('First name', 'Annie')
    expect(ref.current!.isDirty()).toBe(true)
    expect(screen.getByText('Unsaved changes')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Revert' }))
    expect(value('First name')).toBe('Ann')
    expect(ref.current!.isDirty()).toBe(false)
  })

  it('reverts through the handle (Esc)', () => {
    const ref = createRef<ProfileFormHandle>()
    render(<ProfileForm ref={ref} account={acct({ firstName: 'Ann' })} onSaved={() => {}} />)
    expect(ref.current!.revert()).toBe(false)
    type('First name', 'Annie')
    let reverted = false
    act(() => {
      reverted = ref.current!.revert()
    })
    expect(reverted).toBe(true)
    expect(value('First name')).toBe('Ann')
  })

  it('keeps edited fields when the server sends new values, and takes the rest', () => {
    const a = acct({ firstName: 'Ann', lastName: 'Lee', phone: '' })
    const { rerender } = render(<ProfileForm account={a} onSaved={() => {}} />)
    type('First name', 'Annie')
    // A background refresh changes two fields, one of them the one being edited.
    rerender(<ProfileForm account={{ ...a, firstName: 'Anna', lastName: 'Li' }} onSaved={() => {}} />)
    expect(value('First name')).toBe('Annie')
    expect(value('Last name')).toBe('Li')
  })

  it('takes new server values for fields that were not edited', () => {
    const a = acct({ firstName: 'Ann', phone: '' })
    const { rerender } = render(<ProfileForm account={a} onSaved={() => {}} />)
    rerender(<ProfileForm account={{ ...a, phone: '+1 555' }} onSaved={() => {}} />)
    expect(value('Phone number')).toBe('+1 555')
    expect(screen.queryByText('Unsaved changes')).toBeNull()
  })

  it('resets when it shows another account', () => {
    const a = acct({ firstName: 'Ann' })
    const b = acct({ firstName: 'Bo' })
    const { rerender } = render(<ProfileForm account={a} onSaved={() => {}} />)
    type('First name', 'Annie')
    rerender(<ProfileForm account={b} onSaved={() => {}} />)
    expect(value('First name')).toBe('Bo')
    expect(screen.queryByText('Unsaved changes')).toBeNull()
  })

  it('is clean once a save comes back with the saved values', async () => {
    const ham = mockHam()
    const onSaved = vi.fn()
    const ref = createRef<ProfileFormHandle>()
    const a = acct({ firstName: 'Ann' })
    const { rerender } = render(<ProfileForm ref={ref} account={a} onSaved={onSaved} />)
    type('First name', 'Annie')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    })
    expect(ham.accounts.save).toHaveBeenCalledWith(a.id, { firstName: 'Annie', lastName: a.lastName, phone: '' })
    expect(onSaved).toHaveBeenCalledWith({ ok: true })
    rerender(<ProfileForm ref={ref} account={{ ...a, firstName: 'Annie' }} onSaved={onSaved} />)
    expect(ref.current!.isDirty()).toBe(false)
  })
})
