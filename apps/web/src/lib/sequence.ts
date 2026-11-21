/**
 * History rows repeat: a policy push writes "Политика доступа обновлена (v20)"
 * five times in a row. Collapsing consecutive entries with the same signature
 * keeps the log readable without losing the count.
 */
export type ConsecutiveGroup<T> = {
  /** Stable React key: the first item's signature plus its index. */
  id: string
  signature: string
  items: T[]
  count: number
}

export function groupConsecutive<T>(
  items: T[],
  signature: (item: T, index: number) => string
): ConsecutiveGroup<T>[] {
  const groups: ConsecutiveGroup<T>[] = []
  items.forEach((item, index) => {
    const key = signature(item, index)
    const last = groups[groups.length - 1]
    if (last && last.signature === key) {
      last.items.push(item)
      last.count += 1
      return
    }
    groups.push({
      id: `${key}#${index}`,
      signature: key,
      items: [item],
      count: 1,
    })
  })
  return groups
}
