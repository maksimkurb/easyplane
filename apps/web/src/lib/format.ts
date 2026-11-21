/**
 * Relative timestamps in the current UI language. Intl handles plural forms
 * ("2 часа назад") without a translation table for every unit.
 */
export function formatRelativeTime(
  value: string | null | undefined,
  locale: string,
  now = Date.now()
): string | null {
  if (!value) return null
  const time = Date.parse(value)
  if (Number.isNaN(time)) return null
  const diffSeconds = Math.round((time - now) / 1000)
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" })
  const abs = Math.abs(diffSeconds)
  if (abs < 45) return formatter.format(0, "second")
  if (abs < 60 * 45) return formatter.format(Math.round(diffSeconds / 60), "minute")
  if (abs < 60 * 60 * 22) return formatter.format(Math.round(diffSeconds / 3600), "hour")
  if (abs < 60 * 60 * 24 * 6) {
    return formatter.format(Math.round(diffSeconds / 86400), "day")
  }
  return new Date(time).toLocaleDateString(locale)
}

export function formatDateTime(value: string | null | undefined, locale: string): string {
  if (!value) return "—"
  const time = Date.parse(value)
  if (Number.isNaN(time)) return "—"
  return new Date(time).toLocaleString(locale)
}

/** Compact date for lists: "26 нояб., 22:26" (no seconds, no year). */
export function formatDateTimeShort(
  value: string | null | undefined,
  locale: string
): string {
  if (!value) return "—"
  const time = Date.parse(value)
  if (Number.isNaN(time)) return "—"
  return new Date(time).toLocaleString(locale, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
}

/** Time of day only, for rows already grouped under a date heading. */
export function formatTimeOfDay(
  value: string | null | undefined,
  locale: string
): string {
  if (!value) return "—"
  const time = Date.parse(value)
  if (Number.isNaN(time)) return "—"
  return new Date(time).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function formatDate(value: string | null | undefined, locale: string): string {
  if (!value) return "—"
  const time = Date.parse(value)
  if (Number.isNaN(time)) return "—"
  return new Date(time).toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}
