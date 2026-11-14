export type ApiError = {
  status: number
  message: string
  code?: string
  details?: unknown
}

const CSRF_COOKIE = "easyplane_csrf"
const AUTH_REQUIRED_EVENT = "easyplane-auth-required"

export function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null
  const prefix = `${name}=`
  for (const part of document.cookie.split(";")) {
    const trimmed = part.trim()
    if (trimmed.startsWith(prefix)) {
      return decodeURIComponent(trimmed.slice(prefix.length))
    }
  }
  return null
}

const parsePayload = async (response: Response): Promise<unknown> => {
  if (response.status === 204) return undefined
  const contentType = response.headers.get("content-type") ?? ""
  if (contentType.includes("application/json")) return response.json()
  return response.text()
}

const normalizeError = (status: number, payload: unknown): ApiError => {
  if (payload && typeof payload === "object") {
    const body = payload as Record<string, unknown>
    const message =
      typeof body.error === "string"
        ? body.error
        : typeof body.message === "string"
          ? body.message
          : `Request failed with status ${status}`
    return {
      status,
      message,
      code: typeof body.code === "string" ? body.code : undefined,
      details: payload,
    }
  }
  if (typeof payload === "string" && payload.length > 0) {
    return { status, message: payload, details: payload }
  }
  return { status, message: `Request failed with status ${status}`, details: payload }
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"])

/**
 * Orval mutator. Session auth rides in an HttpOnly cookie, and every
 * state-changing request carries the CSRF token from its readable companion
 * cookie (double submit, verified against the PG session server-side).
 */
export const apiFetch = async <T>(
  url: string,
  options: RequestInit = {}
): Promise<T> => {
  const headers = new Headers(options.headers)
  const method = (options.method ?? "GET").toUpperCase()
  if (MUTATING.has(method)) {
    const csrf = readCookie(CSRF_COOKIE)
    if (csrf) headers.set("x-csrf-token", csrf)
  }
  if (options.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json")
  }

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: "same-origin",
  })
  const payload = await parsePayload(response)

  if (response.status === 401 && typeof window !== "undefined") {
    window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT))
  }
  if (!response.ok) throw normalizeError(response.status, payload)
  // Orval's generated clients expect the `{data, status, headers}` envelope.
  return { data: payload, status: response.status, headers: response.headers } as T
}

export { AUTH_REQUIRED_EVENT }
