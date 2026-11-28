// How accounts are arranged in HAM only: local names, pins, manual order,
// groups and tags. Nothing here reaches Hack Club or Slack.
import { randomUUID } from 'node:crypto'
import { TAG_COLORS, type AccountGroup, type AccountTag, type TagColor } from '@shared/types'
import type { Store } from './store'

export class Organizer {
  constructor(
    private readonly store: Store,
    private readonly onChange: () => void
  ) {}

  /** A name only HAM shows. Empty clears it. */
  setLocalName(id: string, name: string) {
    const a = this.store.find(id)
    const clean = name.replace(/\s+/g, ' ').trim().slice(0, 60)
    if (!a || a.localName === clean) return
    this.store.upsert({ ...a, localName: clean })
    this.onChange()
  }

  setPinned(ids: string[], pinned: boolean) {
    for (const id of ids) {
      const a = this.store.find(id)
      if (a && a.pinned !== pinned) this.store.upsert({ ...a, pinned })
    }
    this.onChange()
  }

  reorder(ids: string[]) {
    this.store.reorder(ids)
    this.onChange()
  }

  // --- groups --------------------------------------------------------------

  get groups(): AccountGroup[] {
    return this.store.groups
  }

  /** Move accounts into a group (or out, with null). Moving also unpins, so they show up there. */
  setGroup(ids: string[], groupId: string | null) {
    if (groupId !== null && !this.store.groups.some((g) => g.id === groupId)) return
    for (const id of ids) {
      const a = this.store.find(id)
      if (a && (a.groupId !== groupId || a.pinned)) this.store.upsert({ ...a, groupId, pinned: false })
    }
    this.onChange()
  }

  createGroup(name: string, ids: string[]): string | null {
    const clean = name.trim().slice(0, 60)
    if (!clean) return null
    const id = randomUUID()
    this.store.groups = [...this.store.groups, { id, name: clean }]
    if (ids.length) this.setGroup(ids, id)
    else this.onChange()
    return id
  }

  renameGroup(id: string, name: string) {
    const clean = name.trim().slice(0, 60)
    if (!clean) return
    this.store.groups = this.store.groups.map((g) => (g.id === id ? { ...g, name: clean } : g))
    this.onChange()
  }

  deleteGroup(id: string) {
    this.store.groups = this.store.groups.filter((g) => g.id !== id)
    this.onChange()
  }

  reorderGroups(ids: string[]) {
    const byId = new Map(this.store.groups.map((g) => [g.id, g]))
    const listed = ids.map((id) => byId.get(id)).filter((g): g is AccountGroup => !!g)
    this.store.groups = [...listed, ...this.store.groups.filter((g) => !ids.includes(g.id))]
    this.onChange()
  }

  // --- tags ----------------------------------------------------------------

  get tags(): AccountTag[] {
    return this.store.tags
  }

  /** Add a tag to accounts, or take it off them. */
  setTag(ids: string[], tagId: string, on: boolean) {
    if (!this.store.tags.some((t) => t.id === tagId)) return
    for (const id of ids) {
      const a = this.store.find(id)
      if (!a || a.tagIds.includes(tagId) === on) continue
      this.store.upsert({ ...a, tagIds: on ? [...a.tagIds, tagId] : a.tagIds.filter((t) => t !== tagId) })
    }
    this.onChange()
  }

  createTag(name: string, color: TagColor, ids: string[]): string | null {
    const clean = name.trim().slice(0, 40)
    if (!clean) return null
    const id = randomUUID()
    this.store.tags = [...this.store.tags, { id, name: clean, color: TAG_COLORS.includes(color) ? color : 'gray' }]
    if (ids.length) this.setTag(ids, id, true)
    else this.onChange()
    return id
  }

  updateTag(id: string, patch: { name?: string; color?: TagColor }) {
    const name = patch.name?.trim().slice(0, 40)
    const color = patch.color && TAG_COLORS.includes(patch.color) ? patch.color : undefined
    this.store.tags = this.store.tags.map((t) => (t.id === id ? { ...t, ...(name ? { name } : {}), ...(color ? { color } : {}) } : t))
    this.onChange()
  }

  deleteTag(id: string) {
    this.store.tags = this.store.tags.filter((t) => t.id !== id)
    this.onChange()
  }

  reorderTags(ids: string[]) {
    const byId = new Map(this.store.tags.map((t) => [t.id, t]))
    const listed = ids.map((id) => byId.get(id)).filter((t): t is AccountTag => !!t)
    this.store.tags = [...listed, ...this.store.tags.filter((t) => !ids.includes(t.id))]
    this.onChange()
  }
}
