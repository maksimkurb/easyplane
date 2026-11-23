/**
 * Device descriptions are a short human note ("Роутер в гараже", "Телефон
 * Макса") for people who do not know what a hostname means. They are shown as
 * one line in lists, so the stored value is always a single paragraph: runs of
 * whitespace (including newlines) collapse to one space and the edges are
 * trimmed. Empty input means "no description" and is stored as null.
 */
export const DEVICE_DESCRIPTION_MAX_LENGTH = 280;

export function normalizeDeviceDescription(
  value: string | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  const collapsed = value.replace(/\s+/gu, " ").trim();
  return collapsed === "" ? null : collapsed;
}

/** True when an already-normalized description fits the column contract. */
export function isDeviceDescriptionLengthValid(value: string): boolean {
  return value.length <= DEVICE_DESCRIPTION_MAX_LENGTH;
}
