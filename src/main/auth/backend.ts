// The interface the account service talks to. `AuthClient` implements it
// against auth.hackclub.com; `MockBackend` implements it for demos and tests.
import type { ProfileInput } from '@shared/types'
import type { ParsedProfile } from './pages'

export type StartOutcome =
  | { kind: 'code' }
  | { kind: 'no-account' }
  | { kind: 'rate-limited' }
  | { kind: 'locked'; message: string }
  | { kind: 'unexpected'; message: string }

export type VerifyOutcome =
  | { kind: 'done' }
  | { kind: 'totp' }
  | { kind: 'backup' }
  | { kind: 'passkey-only' }
  | { kind: 'invalid'; message: string }
  | { kind: 'rate-limited' }
  | { kind: 'unexpected'; message: string }

export type ProfileOutcome =
  | { kind: 'ok'; profile: ParsedProfile }
  | { kind: 'signed-out' }
  | { kind: 'unexpected'; message: string }

export type SaveOutcome =
  | { kind: 'ok'; profile: ParsedProfile }
  | { kind: 'validation'; messages: string[] }
  | { kind: 'signed-out' }
  | { kind: 'unexpected'; message: string }

export interface AuthBackend {
  startLogin(email: string): Promise<StartOutcome>
  resend(): Promise<StartOutcome>
  verifyEmailCode(code: string): Promise<VerifyOutcome>
  verifySecondFactor(kind: 'totp' | 'backup', code: string): Promise<VerifyOutcome>
  readProfile(): Promise<ProfileOutcome>
  saveProfile(profile: ProfileInput): Promise<SaveOutcome>
  /** End the session on the server. Resolves true if the server confirmed it. */
  signOut(): Promise<boolean>
  /** When the session cookie expires, as an ISO date. */
  sessionExpiry(): Promise<string | null>
  /** Wipe every cookie and cached file in this account's partition. */
  clearLocalData(): Promise<void>
  /** The current login attempt's path (e.g. "/login/AbC123"), to persist across restarts. */
  attemptPath(): string | null
  /** Pick up a persisted attempt after a restart. Resolves false if it has expired. */
  resumeAttempt(path: string): Promise<boolean>
  /** Whether the partition holds Slack's session cookie (`d` on .slack.com). */
  hasSlackSession(): Promise<boolean>
  /** The account's Hack Club Slack ID from HCA (null: none linked; undefined: couldn't tell). */
  slackId(): Promise<string | null | undefined>
}

export type BackendFactory = (partition: string) => AuthBackend
