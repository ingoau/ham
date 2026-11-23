import type { AccountTag } from '@shared/types'

/** A tag's colour as a small dot. */
export function TagDot({ tag, size = 8 }: { tag: AccountTag; size?: number }) {
  return <span className={`tag-dot tag-${tag.color}`} style={{ width: size, height: size }} aria-hidden />
}

/** Up to three dots for a list row, with the tag names for hover and screen readers. */
export function TagDots({ tags }: { tags: AccountTag[] }) {
  if (tags.length === 0) return null
  const names = tags.map((t) => t.name).join(', ')
  return (
    <span className="tag-dots" title={names} aria-label={`Tags: ${names}`} role="img">
      {tags.slice(0, 3).map((t) => (
        <TagDot key={t.id} tag={t} size={7} />
      ))}
      {tags.length > 3 && <span className="tag-more">+{tags.length - 3}</span>}
    </span>
  )
}
