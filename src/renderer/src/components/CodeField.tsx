import type { Ref } from 'react'
import { OTPInput, REGEXP_ONLY_DIGITS, type SlotProps } from 'input-otp'

function Slot({ char, hasFakeCaret, isActive }: SlotProps) {
  return (
    <div className="otp-slot" data-active={isActive || undefined}>
      {char}
      {hasFakeCaret && <div className="otp-caret" />}
    </div>
  )
}

/** A six-digit code field, split like the emailed "123-456". Pasting "684-629" works. */
export function CodeField({
  id,
  value,
  onChange,
  onComplete,
  disabled,
  inputRef
}: {
  id: string
  value: string
  onChange(v: string): void
  onComplete?(v: string): void
  disabled?: boolean
  inputRef?: Ref<HTMLInputElement>
}) {
  return (
    <OTPInput
      id={id}
      ref={inputRef}
      maxLength={6}
      pattern={REGEXP_ONLY_DIGITS}
      inputMode="numeric"
      autoComplete="one-time-code"
      value={value}
      disabled={disabled}
      pasteTransformer={(text) => text.replace(/\D/g, '').slice(0, 6)}
      onChange={onChange}
      onComplete={onComplete}
      containerClassName="otp"
      render={({ slots }) => (
        <>
          <div className="otp-group">
            {slots.slice(0, 3).map((slot, i) => (
              <Slot key={i} {...slot} />
            ))}
          </div>
          <div className="otp-dash" aria-hidden />
          <div className="otp-group">
            {slots.slice(3).map((slot, i) => (
              <Slot key={i} {...slot} />
            ))}
          </div>
        </>
      )}
    />
  )
}
