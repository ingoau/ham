import { useEffect, useRef } from 'react'
import { autocompletion, closeBrackets, completionKeymap, type Completion } from '@codemirror/autocomplete'
import { jinja } from '@codemirror/lang-jinja'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, placeholder as placeholderExt } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { HCA_FIELDS, SLACK_CUSTOM_FIELDS, SLACK_PROFILE_FIELDS } from '@shared/fields'

const VARIABLES: Completion[] = [
  { label: 'account', type: 'variable', detail: 'this account' },
  { label: 'index', type: 'variable', detail: '1, 2, 3…' },
  { label: 'total', type: 'variable', detail: 'number of accounts' },
  { label: 'current', type: 'variable', detail: 'the field’s current value' }
]

const prop = (label: string, detail: string): Completion => ({ label, type: 'property', detail })

/** Completions after `account.`, `account.hca.`, and so on. */
const PROPS: Record<string, Completion[]> = {
  account: [
    prop('local', 'Local name'),
    prop('email', 'Email'),
    prop('hca', 'Hack Club Auth fields'),
    prop('slack', 'Slack profile fields')
  ],
  'account.hca': HCA_FIELDS.map((f) => prop(f.key, f.name)),
  'account.slack': [...SLACK_PROFILE_FIELDS.map((f) => prop(f.key, f.name)), prop('fields', 'Slack custom fields')],
  'account.slack.fields': SLACK_CUSTOM_FIELDS.map((f) => prop(f.key, f.name))
}

const highlight = HighlightStyle.define([
  { tag: [tags.brace, tags.bracket, tags.punctuation], color: 'var(--faint)' },
  { tag: [tags.variableName, tags.propertyName], color: 'var(--link)' },
  { tag: [tags.string], color: 'var(--ok-text)' },
  { tag: [tags.keyword, tags.operator, tags.function(tags.variableName)], color: 'var(--info-text)' }
])

const theme = EditorView.theme({
  '&': { fontSize: '14px', backgroundColor: 'var(--field)', color: 'var(--text)', borderRadius: '9px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-content': { fontFamily: 'var(--mono)', padding: '10px 0', caretColor: 'var(--text)' },
  '.cm-line': { padding: '0 12px' },
  '.cm-scroller': { overflowX: 'auto', overflowY: 'hidden', scrollbarWidth: 'none' },
  '.cm-placeholder': { color: 'var(--faint)' },
  '.cm-tooltip': { border: '1px solid var(--border)', backgroundColor: 'var(--bg)', borderRadius: '9px', overflow: 'hidden', boxShadow: 'var(--shadow)' },
  '.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--font)', fontSize: '13px', maxHeight: '220px' },
  '.cm-tooltip-autocomplete > ul > li': { padding: '5px 10px !important' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--selected)', color: 'var(--text)' },
  '.cm-completionDetail': { color: 'var(--muted)', fontStyle: 'normal', marginLeft: '10px' },
  '.cm-completionIcon': { display: 'none' }
})

/** Keep it a single line: drop newlines from edits and pastes. */
const singleLine = EditorState.transactionFilter.of((tr) => (tr.newDoc.lines > 1 ? [] : tr))

interface Props {
  id?: string
  value: string
  onChange(value: string): void
  invalid?: boolean
  placeholder?: string
  ariaLabel?: string
}

export function TemplateInput({ id, value, onChange, invalid, placeholder, ariaLabel }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const latest = useRef(onChange)
  latest.current = onChange

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          singleLine,
          closeBrackets(),
          jinja({ variables: VARIABLES, properties: (path) => PROPS[path.join('.')] ?? [] }),
          autocompletion({ activateOnTyping: true, icons: false }),
          keymap.of(completionKeymap),
          syntaxHighlighting(highlight),
          theme,
          placeholder ? placeholderExt(placeholder) : [],
          EditorView.contentAttributes.of({
            ...(id ? { id } : {}),
            'aria-label': ariaLabel ?? 'Template',
            'aria-invalid': invalid ? 'true' : 'false',
            spellcheck: 'false'
          }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) latest.current(u.state.doc.toString())
          })
        ]
      })
    })
    view.current = v
    return () => v.destroy()
    // The editor owns its text after mount; outside changes sync below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const v = view.current
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } })
  }, [value])

  return <div ref={host} className={`template-input${invalid ? ' invalid' : ''}`} />
}
