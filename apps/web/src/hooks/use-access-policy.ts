import { useEffect, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"

import {
  getGetNetworkPolicyQueryKey,
  getGetNetworkQueryKey,
  getGetPolicySubjectsQueryKey,
  getListDevicesQueryKey,
  getListNetworkPolicyVersionsQueryKey,
  getListNetworkRoutesQueryKey,
  getListTagsQueryKey,
  getListUserGroupsQueryKey,
  useGetNetworkPolicy,
  useSaveNetworkPolicy,
  useSetNetworkPolicyMode,
} from "@/api/generated/easyplane"
import type { RuleFieldErrors } from "@/components/access/rule-editor"
import type {
  AccessChain,
  AccessChainName,
  AccessDocument,
  AccessMode,
  AccessRule,
} from "@/lib/access-policy"

export type RuleErrors = Record<number, RuleFieldErrors>
import {
  defaultAccessRule,
  emptyAccessDocument,
  normalizeAccessDocument,
  ruleIsSavable,
} from "@/lib/access-policy"

type QueueItem = {
  document: AccessDocument
  mode: AccessMode
  ruleIndex?: number
}

function mapSaveError(message: string): {
  field?: keyof RuleFieldErrors
  general?: string
} {
  const lower = message.toLowerCase()
  if (/burst/.test(lower)) return { field: "burst" }
  if (/source\s*port/.test(lower)) return { field: "sourcePorts" }
  if (/port/.test(lower)) return { field: "ports" }
  if (/duplicate|unique|rule name/.test(lower)) return { field: "name" }
  if (/rate/.test(lower)) return { field: "rate" }
  if (/from|source/.test(lower)) return { field: "from" }
  if (/to\b|destination/.test(lower)) return { field: "to" }
  if (/protocol/.test(lower)) return { field: "protocol" }
  return { general: message }
}

function uniqueRuleName(rules: AccessRule[], name: string): string {
  const base = name.trim()
  if (!base) return ""
  const taken = new Set(rules.map((rule) => rule.name?.trim()).filter(Boolean))
  if (!taken.has(base)) return base
  let suffix = 2
  while (taken.has(`${base} (${suffix})`)) suffix += 1
  return `${base} (${suffix})`
}

/**
 * Local, optimistic policy document on top of GET/PUT /policy.
 *
 * Every change updates the local document first, then saves the whole document
 * (the API has no per-rule endpoint). Saves are serialized: while one is in
 * flight the newest document waits, so a fast toggle sequence cannot arrive out
 * of order. Free-text fields debounce; discrete controls save immediately.
 */
export function useAccessPolicy(networkId: string) {
  const queryClient = useQueryClient()
  const policyQuery = useGetNetworkPolicy(networkId)
  const saveMutation = useSaveNetworkPolicy()
  const modeMutation = useSetNetworkPolicyMode()

  const [document, setDocument] = useState<AccessDocument>(() =>
    emptyAccessDocument("open")
  )
  const [mode, setMode] = useState<AccessMode>("open")
  const [saving, setSaving] = useState(false)
  const [ruleErrors, setRuleErrors] = useState<RuleErrors>({})
  const [generalError, setGeneralError] = useState<string>()

  const lastVersionRef = useRef(-1)
  const lastModeRef = useRef<AccessMode>("open")
  const queueRef = useRef<QueueItem | null>(null)
  const runningRef = useRef(false)
  const timerRef = useRef<number | null>(null)
  const latestRef = useRef<QueueItem | null>(null)
  // Delayed callbacks (the undo toast) must see the document as it is now,
  // not the one captured when the deletion was rendered.
  const documentRef = useRef<AccessDocument>(document)
  useEffect(() => {
    documentRef.current = document
  }, [document])

  const version = policyQuery.data?.data?.version ?? 0

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: getGetNetworkPolicyQueryKey(networkId),
      }),
      queryClient.invalidateQueries({
        queryKey: getListNetworkPolicyVersionsQueryKey(networkId),
      }),
      queryClient.invalidateQueries({
        queryKey: getGetPolicySubjectsQueryKey(networkId),
      }),
      queryClient.invalidateQueries({
        queryKey: getGetNetworkQueryKey(networkId),
      }),
      queryClient.invalidateQueries({ queryKey: getListDevicesQueryKey() }),
      queryClient.invalidateQueries({
        queryKey: getListNetworkRoutesQueryKey(networkId),
      }),
      queryClient.invalidateQueries({ queryKey: getListTagsQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getListUserGroupsQueryKey() }),
    ])
  }

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const runQueue = async () => {
    if (runningRef.current) return
    runningRef.current = true
    setSaving(true)
    while (queueRef.current) {
      const item = queueRef.current
      queueRef.current = null
      try {
        const response = await saveMutation.mutateAsync({
          networkId,
          data: {
            document: item.document as unknown as Record<string, unknown>,
            mode: item.mode,
          },
        })
        lastVersionRef.current = response.data.policy.version
        lastModeRef.current = response.data.mode
        setMode(response.data.mode)
        setRuleErrors({})
        setGeneralError(undefined)
        await refresh()
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : ""
        const mapped = mapSaveError(message)
        if (mapped.field && item.ruleIndex !== undefined) {
          setRuleErrors((current) => ({
            ...current,
            [item.ruleIndex!]: {
              ...current[item.ruleIndex!],
              [mapped.field!]: message,
            },
          }))
        } else if (message) {
          setGeneralError(message)
        }
        break
      }
    }
    runningRef.current = false
    setSaving(false)
  }

  const submit = (
    next: AccessDocument,
    modeOverride: AccessMode,
    ruleIndex?: number
  ) => {
    const payload = { ...next, mode: modeOverride }
    setDocument(payload)
    queueRef.current = {
      document: payload,
      mode: modeOverride,
      ...(ruleIndex !== undefined ? { ruleIndex } : {}),
    }
    void runQueue()
  }

  const schedule = (
    next: AccessDocument,
    modeOverride: AccessMode,
    ruleIndex: number | undefined,
    debounce: boolean
  ) => {
    const payload = { ...next, mode: modeOverride }
    setDocument(payload)
    setGeneralError(undefined)
    setRuleErrors((current) => {
      if (ruleIndex === undefined || !current[ruleIndex]) return current
      const copy = { ...current }
      delete copy[ruleIndex]
      return copy
    })
    if (!debounce) {
      clearTimer()
      latestRef.current = null
      submit(payload, modeOverride, ruleIndex)
      return
    }
    latestRef.current = {
      document: payload,
      mode: modeOverride,
      ...(ruleIndex !== undefined ? { ruleIndex } : {}),
    }
    clearTimer()
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      const item = latestRef.current
      latestRef.current = null
      if (item) submit(item.document, item.mode, item.ruleIndex)
    }, 600)
  }

  // Adopt the server document when the version changes and nothing local is
  // waiting. A save updates lastVersionRef first, so its own refetch is ignored.
  useEffect(() => {
    const data = policyQuery.data?.data
    if (!data || runningRef.current || queueRef.current) return
    if (data.version !== lastVersionRef.current) {
      lastVersionRef.current = data.version
      setDocument(
        normalizeAccessDocument(data.document ?? emptyAccessDocument(data.mode))
      )
      setRuleErrors({})
    }
    if (data.mode !== lastModeRef.current) {
      lastModeRef.current = data.mode
      setMode(data.mode)
    }
  }, [policyQuery.data])

  useEffect(() => () => clearTimer(), [])

  const updateRule = (index: number, patch: Partial<AccessRule>) => {
    const nextRules = document.rules.map((rule, position) =>
      position === index ? { ...rule, ...patch } : rule
    )
    const target = nextRules[index]
    if (!target) return
    const next = { ...document, rules: nextRules }
    const debounce = "name" in patch || "rateLimit" in patch || "burst" in patch
    if (!ruleIsSavable(target)) {
      setDocument({ ...next, mode })
      setGeneralError(undefined)
      return
    }
    schedule(next, mode, index, debounce)
  }

  const saveWholeRule = (index: number, rule: AccessRule) => {
    const nextRules = document.rules.map((entry, position) =>
      position === index ? rule : entry
    )
    const next = { ...document, rules: nextRules }
    if (!ruleIsSavable(rule)) {
      setDocument({ ...next, mode })
      return
    }
    schedule(next, mode, index, false)
  }

  const addRule = (rule: AccessRule = defaultAccessRule()) => {
    const base =
      version === 0 && document.rules.length === 0
        ? emptyAccessDocument("rules")
        : document
    const targetMode: "open" | "rules" = mode === "open" ? "open" : "rules"
    const next = {
      ...base,
      mode: targetMode,
      rules: [...base.rules, rule],
    }
    setMode(targetMode)
    schedule(next, targetMode, next.rules.length - 1, false)
  }

  const insertRule = (index: number, rule: AccessRule) => {
    const current = documentRef.current
    const rules = [...current.rules]
    const target = Math.min(Math.max(index, 0), rules.length)
    rules.splice(target, 0, rule)
    schedule({ ...current, rules }, mode, undefined, false)
  }

  const deleteRule = (index: number) => {
    const next = {
      ...document,
      rules: document.rules.filter((_, position) => position !== index),
    }
    schedule(next, mode, undefined, false)
  }

  const moveRule = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= document.rules.length) return
    reorderRule(index, target)
  }

  const reorderRule = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0) return
    const rules = [...document.rules]
    const [moved] = rules.splice(from, 1)
    if (!moved) return
    rules.splice(to, 0, moved)
    schedule({ ...document, rules }, mode, undefined, false)
  }

  const duplicateRule = (index: number) => {
    const source = document.rules[index]
    if (!source) return
    const copy: AccessRule = {
      ...source,
      from: [...source.from],
      to: [...source.to],
      ports: [...source.ports],
      sourcePorts: [...source.sourcePorts],
      ...(source.name
        ? { name: uniqueRuleName(document.rules, `${source.name} copy`) }
        : {}),
    }
    const rules = [...document.rules]
    rules.splice(index + 1, 0, copy)
    schedule({ ...document, rules }, mode, undefined, false)
  }

  const changeChain = (name: AccessChainName, patch: Partial<AccessChain>) => {
    const next = {
      ...document,
      chains: {
        ...document.chains,
        [name]: { ...document.chains[name], ...patch },
      },
    }
    schedule(next, mode, undefined, false)
  }

  const changeChains = (chains: Record<AccessChainName, AccessChain>) => {
    schedule({ ...document, chains }, mode, undefined, false)
  }

  const changeMode = async (next: AccessMode) => {
    if (next === mode || saving) return
    setGeneralError(undefined)
    if (next === "open") {
      if (version === 0) {
        setMode("open")
        lastModeRef.current = "open"
        return
      }
      try {
        await modeMutation.mutateAsync({ networkId, data: { mode: "open" } })
        setMode("open")
        lastModeRef.current = "open"
        await refresh()
      } catch (cause) {
        setGeneralError(cause instanceof Error ? cause.message : "")
      }
      return
    }
    if (version === 0) {
      const base = emptyAccessDocument(next)
      const nextDocument: AccessDocument = {
        ...base,
        rules: [defaultAccessRule()],
      }
      setMode(next)
      submit(nextDocument, next)
      return
    }
    try {
      await modeMutation.mutateAsync({ networkId, data: { mode: next } })
      setMode(next)
      setDocument((current) => ({ ...current, mode: next }))
      lastModeRef.current = next
      await refresh()
    } catch (cause) {
      setGeneralError(cause instanceof Error ? cause.message : "")
    }
  }

  return {
    document,
    mode,
    version,
    loading: policyQuery.isLoading,
    saving,
    ruleErrors,
    generalError,
    updateRule,
    saveWholeRule,
    addRule,
    insertRule,
    deleteRule,
    moveRule,
    reorderRule,
    duplicateRule,
    changeChain,
    changeChains,
    changeMode,
    refresh,
  }
}
