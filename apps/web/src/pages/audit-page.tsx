import { Fragment, useMemo, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "wouter"
import { HistoryIcon, SearchIcon } from "lucide-react"

import {
  useListAuditLog,
  useListDevices,
  useListNetworks,
  useListUsers,
} from "@/api/generated/easyplane"
import type { ListAuditLog200Item } from "@/api/generated/model"
import { useAuth } from "@/auth/auth-context"
import { PageContainer } from "@/components/layout/page-container"
import { PageHeader } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Segmented } from "@/components/ui/segmented"
import { Skeleton } from "@/components/ui/skeleton"
import { deviceName } from "@/lib/device-presentation"
import { formatDate, formatDateTime, formatTimeOfDay } from "@/lib/format"
import {
  auditCategory,
  auditEventKey,
  humanizeAuditAction,
  isGroupableAuditEntry,
  metadataString,
  shortId,
  type AuditCategory,
  type AuditFilter,
} from "@/lib/audit-events"

const PAGE_SIZE = 100
const MAX_LIMIT = 500

const MARK = (name: string) => `@@${name}@@`
const MARK_RE = /@@(\w+)@@/g

/** Turns a translation template into nodes so the target can be a real link. */
function renderMarkers(
  template: string,
  nodes: Record<string, ReactNode>
): ReactNode[] {
  return template
    .split(MARK_RE)
    .map((part, index) =>
      index % 2 === 0 ? (
        part
      ) : (
        <Fragment key={index}>{nodes[part] ?? part}</Fragment>
      )
    )
}

function markerText(template: string, values: Record<string, string>): string {
  return template.replace(MARK_RE, (_match, key: string) => values[key] ?? "")
}

type ResolvedEntry = {
  entry: ListAuditLog200Item
  category: AuditCategory | null
  sentence: ReactNode
  searchText: string
}

type AuditItem =
  | ({ kind: "single" } & ResolvedEntry)
  | {
      kind: "group"
      action: string
      items: ResolvedEntry[]
      count: number
      /** Config pushes already say "to N devices"; other repeats get a ×N chip. */
      showCount: boolean
      category: AuditCategory | null
      createdAt: string
      sentence: ReactNode
      searchText: string
      title: string
    }

/** Actions that repeat in bursts and read better as one line. */
const REPEATABLE_ACTIONS = new Set([
  "device.config.pushed",
  "device.config.push_failed",
  "route.unapproved_reported",
  "route.declared",
])

/**
 * "Activity" is the audit log in the user's language. Every row is a sentence
 * (actor, action, target link), repeated system pushes collapse into one line,
 * and the raw event code only survives as a fallback for actions this build
 * does not know yet.
 */
export function AuditPage() {
  const { t, i18n } = useTranslation()
  const { isAdmin } = useAuth()
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [eventFilter, setEventFilter] = useState<AuditFilter>("all")
  const [query, setQuery] = useState("")
  // "Today"/"Yesterday" are resolved once per visit rather than on every render.
  const [now] = useState(() => Date.now())

  const auditQuery = useListAuditLog({ limit }, { query: { enabled: isAdmin } })
  const usersQuery = useListUsers({ query: { enabled: isAdmin } })
  const devicesQuery = useListDevices(undefined, {
    query: { enabled: isAdmin },
  })
  const networksQuery = useListNetworks({ query: { enabled: isAdmin } })

  const entries = useMemo(() => auditQuery.data?.data ?? [], [auditQuery.data])
  const usersById = useMemo(
    () => new Map((usersQuery.data?.data ?? []).map((user) => [user.id, user])),
    [usersQuery.data]
  )
  const devicesById = useMemo(
    () =>
      new Map(
        (devicesQuery.data?.data ?? []).map((device) => [device.id, device])
      ),
    [devicesQuery.data]
  )
  const networksById = useMemo(
    () =>
      new Map(
        (networksQuery.data?.data ?? []).map((network) => [network.id, network])
      ),
    [networksQuery.data]
  )

  const items = useMemo<AuditItem[]>(() => {
    const targetFor = (entry: ListAuditLog200Item) => {
      let text: string
      let href: string | null = null
      switch (entry.targetType) {
        case "device": {
          const device = devicesById.get(entry.targetId)
          text =
            (device ? deviceName(device) : null) ??
            metadataString(entry, "hostname") ??
            shortId(entry.targetId)
          if (device) href = `/devices/${device.id}`
          break
        }
        case "network": {
          const network = networksById.get(entry.targetId)
          text =
            (network ? network.name : null) ??
            metadataString(entry, "name") ??
            shortId(entry.targetId)
          if (network) href = `/networks/${network.id}`
          break
        }
        case "invite": {
          const label = metadataString(entry, "label")
          text = label
            ? t("audit.target.inviteLabel", { label })
            : t("audit.target.inviteId", { id: shortId(entry.targetId) })
          const networkId = metadataString(entry, "networkId")
          if (networkId) href = `/networks/${networkId}/settings`
          break
        }
        case "tag":
          text = metadataString(entry, "name") ?? shortId(entry.targetId)
          break
        case "user_group":
          text = metadataString(entry, "name") ?? shortId(entry.targetId)
          break
        default:
          text = entry.targetId ? shortId(entry.targetId) : ""
      }
      return { text, href }
    }

    const resolve = (entry: ListAuditLog200Item): ResolvedEntry => {
      const category = auditCategory(entry.action)
      const target = targetFor(entry)
      const user = entry.actorUserId
        ? usersById.get(entry.actorUserId)
        : undefined
      const actorName =
        entry.actorType === "system"
          ? t("audit.actor.system")
          : entry.actorType === "device"
            ? target.text || t("audit.actor.device")
            : user?.displayName || user?.email || shortId(entry.actorUserId)

      const networkId = metadataString(entry, "networkId")
      const network = networkId ? networksById.get(networkId) : undefined
      const networkText = network?.name ?? (networkId ? shortId(networkId) : "")
      const revision =
        metadataString(entry, "revision") ?? metadataString(entry, "rollbackOf")
      const version = metadataString(entry, "version")
      const cidr = metadataString(entry, "cidr")
      const renamedTo = metadataString(entry, "dnsName")
      const detail = revision ?? version ?? cidr ?? ""
      const count =
        entry.action === "credential.revoked_all" ||
        entry.action === "credential.renewed"
          ? Number(metadataString(entry, "count") ?? 0)
          : undefined

      const nodes: Record<string, ReactNode> = {
        actor: <span className="font-medium">{actorName}</span>,
        target: target.text ? (
          target.href ? (
            <Link
              className="font-medium underline-offset-2 hover:underline"
              href={target.href}
            >
              {target.text}
            </Link>
          ) : (
            <span className="font-medium">{target.text}</span>
          )
        ) : null,
        network: networkText ? (
          network ? (
            <Link
              className="underline-offset-2 hover:underline"
              href={`/networks/${network.id}`}
            >
              {networkText}
            </Link>
          ) : (
            networkText
          )
        ) : null,
        name: renamedTo ? (
          <span className="font-medium">{renamedTo}</span>
        ) : null,
        detail: detail ? (
          <span className="font-mono text-xs">{detail}</span>
        ) : null,
      }
      const plain = {
        actor: actorName,
        target: target.text,
        network: networkText,
        name: renamedTo ?? "",
        detail,
      }

      let templateKey = auditEventKey(entry.action)
      if (entry.action === "device.role_changed") {
        templateKey =
          metadataString(entry, "to") === "anchor"
            ? `${templateKey}_anchor`
            : `${templateKey}_member`
      }

      const markers = {
        actor: MARK("actor"),
        target: MARK("target"),
        network: MARK("network"),
        name: MARK("name"),
        detail: MARK("detail"),
      }
      let template = t(templateKey, {
        ...markers,
        ...(count !== undefined ? { count } : {}),
      })

      // A newer server may emit an action this build has no copy for. Show a
      // readable sentence instead of `some.raw_code`.
      if (template === templateKey) {
        const human = humanizeAuditAction(entry.action)
        template = `${MARK("actor")} · ${human}${
          target.text ? ` · ${MARK("target")}` : ""
        }`
      }

      return {
        entry,
        category,
        sentence: renderMarkers(template, nodes),
        searchText: markerText(template, plain),
      }
    }

    const resolved = entries.map(resolve)
    const grouped: AuditItem[] = []
    for (const item of resolved) {
      const last = grouped[grouped.length - 1]
      const repeatable = REPEATABLE_ACTIONS.has(item.entry.action)
      const sameAction = last?.kind === "group" && last.action === item.entry.action
      // Config pushes group across devices; device-reported routes group only
      // when they are about the same device, so unrelated reports stay apart.
      const sameTarget =
        last?.kind === "group" &&
        last.items[0]?.entry.targetId === item.entry.targetId
      const canMerge =
        repeatable &&
        sameAction &&
        (isGroupableAuditEntry(item.entry) || sameTarget)

      if (canMerge && last?.kind === "group") {
        const groupItems = [...last.items, item]
        const configPush =
          item.entry.action === "device.config.pushed" ||
          item.entry.action === "device.config.push_failed"
        const key =
          item.entry.action === "device.config.push_failed"
            ? "audit.events.device_config_push_failed_group"
            : "audit.events.device_config_pushed_group"
        const sentence = configPush
          ? t(key, { count: groupItems.length })
          : last.sentence
        grouped[grouped.length - 1] = {
          kind: "group",
          action: item.entry.action,
          items: groupItems,
          count: groupItems.length,
          showCount: !configPush,
          category: last.category,
          createdAt: last.createdAt,
          sentence,
          searchText: `${groupItems
            .map((entry) => entry.searchText)
            .join(" ")}${configPush ? ` ${sentence}` : ""}`,
          title: groupItems
            .map((entry) => entry.entry)
            .map((entry) => targetFor(entry).text)
            .filter(Boolean)
            .join(", "),
        }
        continue
      }
      if (repeatable) {
        grouped.push({
          kind: "group",
          action: item.entry.action,
          items: [item],
          count: 1,
          showCount: false,
          category: item.category,
          createdAt: item.entry.createdAt,
          sentence: item.sentence,
          searchText: item.searchText,
          title: targetFor(item.entry).text,
        })
        continue
      }
      grouped.push({ kind: "single", ...item })
    }
    return grouped
    // `t` and the maps are the only inputs; language changes rebuild sentences.
  }, [devicesById, entries, networksById, t, usersById])

  const needle = query.trim().toLowerCase()
  const filtered = items.filter((item) => {
    if (eventFilter !== "all" && item.category !== eventFilter) return false
    if (!needle) return true
    return item.searchText.toLowerCase().includes(needle)
  })

  // Entries read as a diary: "Today", "Yesterday", then the absolute date.
  const dayKeyOf = (value: string) => {
    const date = new Date(value)
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
  }
  const createdAtOf = (item: AuditItem) =>
    item.kind === "single" ? item.entry.createdAt : item.createdAt
  const todayKey = dayKeyOf(new Date(now).toISOString())
  const yesterdayKey = dayKeyOf(new Date(now - 86_400_000).toISOString())
  const sections: { key: string; label: string; items: AuditItem[] }[] = []
  for (const item of filtered) {
    const createdAt = createdAtOf(item)
    const key = dayKeyOf(createdAt)
    const last = sections[sections.length - 1]
    if (last && last.key === key) {
      last.items.push(item)
      continue
    }
    sections.push({
      key,
      label:
        key === todayKey
          ? t("audit.dates.today")
          : key === yesterdayKey
            ? t("audit.dates.yesterday")
            : formatDate(createdAt, i18n.language),
      items: [item],
    })
  }

  if (!isAdmin) {
    return (
      <PageContainer className="py-6 sm:py-8">
        <p className="text-sm text-muted-foreground">{t("common.forbidden")}</p>
      </PageContainer>
    )
  }

  const canLoadMore = entries.length >= limit && limit < MAX_LIMIT

  return (
    <PageContainer className="py-6 sm:py-8">
      <PageHeader
        description={t("audit.description")}
        title={t("audit.title")}
      />

      <div className="mb-4 flex flex-col gap-3">
        <div className="relative w-full sm:max-w-[340px]">
          <SearchIcon
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-3"
          />
          <Input
            aria-label={t("audit.searchLabel")}
            className="min-h-11 pl-9 text-ellipsis sm:min-h-10"
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("audit.searchPlaceholder")}
            type="search"
            value={query}
          />
        </div>
        <div className="relative min-w-0 max-w-full">
          <div className="overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <Segmented
              className="max-sm:[&>button]:h-11"
              label={t("audit.filterLabel")}
              onValueChange={setEventFilter}
              options={[
                { value: "all", label: t("audit.filters.all") },
                { value: "signin", label: t("audit.filters.signin") },
                { value: "access", label: t("audit.filters.access") },
                { value: "devices", label: t("audit.filters.devices") },
                { value: "invites", label: t("audit.filters.invites") },
              ]}
              value={eventFilter}
            />
          </div>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-background to-transparent md:hidden"
          />
        </div>
      </div>

      {auditQuery.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      ) : entries.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HistoryIcon />
            </EmptyMedia>
            <EmptyTitle>{t("audit.emptyTitle")}</EmptyTitle>
            <EmptyDescription>{t("audit.empty")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : filtered.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HistoryIcon />
            </EmptyMedia>
            <EmptyTitle>{t("audit.emptyFilteredTitle")}</EmptyTitle>
            <EmptyDescription>{t("audit.emptyFiltered")}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              onClick={() => {
                setQuery("")
                setEventFilter("all")
              }}
              size="sm"
              variant="outline"
            >
              {t("audit.clearFilters")}
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <>
          <ol className="overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-line">
            {sections.map((section) => (
              <Fragment key={section.key}>
                <li className="border-b border-line bg-surface-2/60 px-4 py-2 text-xs font-medium text-fg-2 md:px-5">
                  <h2>{section.label}</h2>
                </li>
                {section.items.map((item) => {
                  const key =
                    item.kind === "single"
                      ? item.entry.id
                      : `${item.action}-${item.items[0]?.entry.id ?? item.createdAt}`
                  return (
                    <li
                      className="grid gap-1 border-b border-line px-4 py-3 last:border-b-0 md:grid-cols-[128px_minmax(0,1fr)] md:gap-4 md:px-5"
                      key={key}
                    >
                      <time
                        className="text-xs whitespace-nowrap text-fg-3"
                        dateTime={createdAtOf(item)}
                        title={formatDateTime(createdAtOf(item), i18n.language)}
                      >
                        {formatTimeOfDay(createdAtOf(item), i18n.language)}
                      </time>
                      <div
                        className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-[13.5px] leading-5 text-pretty"
                        title={item.kind === "group" ? item.title : undefined}
                      >
                        <span className="min-w-0">{item.sentence}</span>
                        {item.kind === "group" &&
                        item.showCount &&
                        item.count > 1 ? (
                          <span
                            aria-label={t("audit.repeated", {
                              count: item.count,
                            })}
                            className="inline-flex h-5 items-center rounded-md bg-surface-2 px-1.5 text-xs font-medium text-fg-2 ring-1 ring-line"
                          >
                            ×{item.count}
                          </span>
                        ) : null}
                      </div>
                    </li>
                  )
                })}
              </Fragment>
            ))}
          </ol>

          <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-fg-3">
            <span>{t("audit.showing", { count: entries.length })}</span>
            {canLoadMore ? (
              <Button
                disabled={auditQuery.isFetching}
                onClick={() =>
                  setLimit((value) => Math.min(MAX_LIMIT, value + PAGE_SIZE))
                }
                size="sm"
                variant="outline"
              >
                {t("audit.loadMore")}
              </Button>
            ) : null}
          </div>
        </>
      )}
    </PageContainer>
  )
}
