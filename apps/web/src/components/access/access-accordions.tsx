import { useMemo, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import {
  CheckCircle2Icon,
  ChevronDownIcon,
  HistoryIcon,
  LockIcon,
  NetworkIcon,
  PlusIcon,
  SquareTerminalIcon,
  TagIcon,
  Trash2Icon,
  UsersIcon,
  XCircleIcon,
  XIcon,
} from "lucide-react"

import type {
  GetCompiledAcl200,
  ListNetworkPolicyVersions200Item,
  ListUsers200Item,
} from "@/api/generated/model"
import {
  useAddUserGroupMember,
  useAssignTagDevices,
  useCreateTag,
  useCreateUserGroup,
  useDeleteTag,
  useDeleteUserGroup,
  useGetCompiledAcl,
  useRemoveUserGroupMember,
  useTestNetworkReachability,
} from "@/api/generated/easyplane"
import type { TestNetworkReachabilityBodyProtocol } from "@/api/generated/model"
import type {
  AccessChainName,
  AccessMode,
  AccessSubjects,
  AccessUserGroup,
} from "@/lib/access-policy"
import { formatRelativeTime } from "@/lib/format"
import { initials } from "@/lib/initials"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { GroupChip, PlainDeviceChip, TagChip } from "@/components/access/access-chips"
import { cn } from "@/lib/utils"

type AccordionKey = "subnets" | "tags" | "groups" | "test" | "compiled" | "version"

function AccordionItem({
  id,
  icon,
  title,
  count,
  open,
  onToggle,
  children,
}: {
  id: AccordionKey
  icon: ReactNode
  title: string
  count?: number
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <div className="border-b border-line last:border-b-0">
      <h3 className="m-0">
        <button
          aria-expanded={open}
          className="flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-xl px-3 text-left text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none max-sm:min-h-12"
          data-testid={`accordion-${id}`}
          onClick={onToggle}
          type="button"
        >
          <span className="flex-none text-fg-3">{icon}</span>
          <span className="min-w-0">{title}</span>
          {count !== undefined ? (
            <span className="inline-flex h-5 min-w-5 flex-none items-center justify-center rounded-full bg-surface-2 px-1.5 text-[12px] font-medium text-fg-2 tabular-nums">
              {count}
            </span>
          ) : null}
          <ChevronDownIcon
            aria-hidden="true"
            className={cn(
              "ml-auto size-4 flex-none text-fg-3 transition-transform",
              open && "rotate-180"
            )}
          />
        </button>
      </h3>
      {open ? <div className="flex flex-col gap-2.5 px-3 pb-3">{children}</div> : null}
    </div>
  )
}

function InlineError({ message }: { message?: string }) {
  if (!message) return null
  return (
    <p aria-live="assertive" className="text-[12.5px] leading-[18px] text-err" role="alert">
      {message}
    </p>
  )
}

function accessSubnets(subjects: AccessSubjects) {
  return subjects.subnets.filter((subnet) => subnet.approved)
}

/* ------------------------------------------------------------------ subnets */

function SubnetsBody({ subjects }: { subjects: AccessSubjects }) {
  const { t } = useTranslation()
  const subnets = accessSubnets(subjects)
  if (subnets.length === 0) {
    return <p className="text-[13px] text-fg-2">{t("accessA.accordion.noSubnets")}</p>
  }
  return (
    <div className="flex flex-col gap-1.5">
      {subnets.map((subnet) => (
        <div
          className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm"
          key={`${subnet.id}-${subnet.cidr}`}
        >
          <span className="font-medium">{subnet.name}</span>
          <span className="font-mono text-[12.5px] text-fg-2 [overflow-wrap:anywhere]">
            {subnet.cidr}
          </span>
          <span className="text-[12.5px] text-fg-2">
            {t("accessA.accordion.via", { device: subnet.viaHostname })}
          </span>
        </div>
      ))}
    </div>
  )
}

/* --------------------------------------------------------------------- tags */

function TagsBody({
  subjects,
  canEdit,
  refresh,
}: {
  subjects: AccessSubjects
  canEdit: boolean
  refresh: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [assignOpen, setAssignOpen] = useState<string | null>(null)
  const [newTagOpen, setNewTagOpen] = useState(false)
  const [tagName, setTagName] = useState("")
  const [error, setError] = useState<string>()
  const createTag = useCreateTag()
  const deleteTag = useDeleteTag()
  const assign = useAssignTagDevices()
  const devices = subjects.devices.filter((device) => device.state === "approved")

  const fail = (cause: unknown) =>
    setError(cause instanceof Error ? cause.message : t("common.error"))

  return (
    <div className="flex flex-col gap-2.5">
      <InlineError message={error} />
      {subjects.tags.length === 0 ? (
        <p className="text-[13px] text-fg-2">{t("accessA.accordion.noTags")}</p>
      ) : null}
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {subjects.tags.map((tag) => {
          const open = assignOpen === tag.id
          return (
            <div
              className="flex min-w-0 flex-col gap-2 rounded-[10px] bg-surface-2 p-2.5 shadow-[inset_0_0_0_1px_var(--line)]"
              key={tag.id}
            >
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <TagChip name={tag.name} />
                <span className="text-[12.5px] leading-[18px] text-fg-2">
                  {t("accessA.accordion.devices", { count: tag.deviceCount })}
                </span>
                {canEdit ? (
                  <button
                    aria-label={t("accessA.accordion.deleteTag", { name: tag.name })}
                    className="ml-auto grid size-7 flex-none place-items-center rounded-md text-fg-3 hover:bg-err-soft hover:text-err focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                    disabled={deleteTag.isPending}
                    onClick={() => {
                      setError(undefined)
                      deleteTag.mutate(
                        { tagId: tag.id },
                        {
                          onSuccess: () => void refresh(),
                          onError: fail,
                        }
                      )
                    }}
                    type="button"
                  >
                    <Trash2Icon aria-hidden="true" className="size-4" />
                  </button>
                ) : null}
              </div>
              <div className="flex min-w-0 flex-wrap gap-1.5">
                {tag.devices.map((device) => (
                  <PlainDeviceChip key={device.id} name={device.name} />
                ))}
                {canEdit ? (
                  <button
                    aria-expanded={open}
                    className="inline-flex min-h-6 items-center gap-1 rounded-[7px] bg-card px-2 text-[13px] text-fg-2 shadow-[inset_0_0_0_1px_var(--line)] hover:bg-surface-3 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                    onClick={() => setAssignOpen(open ? null : tag.id)}
                    type="button"
                  >
                    <PlusIcon aria-hidden="true" className="size-3.5" />
                    {t("accessA.accordion.assign")}
                  </button>
                ) : null}
              </div>
              {open ? (
                <div className="grid gap-0.5 border-t border-line pt-1.5 sm:grid-cols-2">
                  {devices.map((device) => {
                    const checked = tag.devices.some((entry) => entry.id === device.id)
                    return (
                      <label
                        className="flex min-h-9 cursor-pointer items-center gap-2.5 text-sm"
                        key={device.id}
                      >
                        <input
                          checked={checked}
                          className="size-[18px] accent-[var(--brand)]"
                          disabled={assign.isPending}
                          onChange={() => {
                            const ids = checked
                              ? tag.devices
                                  .filter((entry) => entry.id !== device.id)
                                  .map((entry) => entry.id)
                              : [...tag.devices.map((entry) => entry.id), device.id]
                            setError(undefined)
                            assign.mutate(
                              { tagId: tag.id, data: { deviceIds: ids } },
                              {
                                onSuccess: () => void refresh(),
                                onError: fail,
                              }
                            )
                          }}
                          type="checkbox"
                        />
                        <span className="min-w-0 [overflow-wrap:anywhere]">{device.name}</span>
                      </label>
                    )
                  })}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>

      {canEdit ? (
        newTagOpen ? (
          <div className="flex flex-wrap items-center gap-2">
            <input
              aria-label={t("accessA.accordion.tagName")}
              className="h-9 min-w-0 flex-1 rounded-lg border-0 bg-card px-2.5 text-sm shadow-[inset_0_0_0_1px_var(--line-2)] outline-0 focus:shadow-[inset_0_0_0_1.5px_var(--brand),0_0_0_3px_var(--brand-soft)] sm:max-w-60"
              onChange={(event) => setTagName(event.target.value)}
              placeholder={t("accessA.accordion.tagName")}
              value={tagName}
            />
            <Button
              disabled={createTag.isPending || tagName.trim() === ""}
              onClick={() => {
                setError(undefined)
                createTag.mutate(
                  { data: { name: tagName.trim() } },
                  {
                    onSuccess: () => {
                      setTagName("")
                      setNewTagOpen(false)
                      void refresh()
                    },
                    onError: fail,
                  }
                )
              }}
              size="sm"
              type="button"
            >
              {t("accessA.accordion.create")}
            </Button>
            <Button
              onClick={() => {
                setNewTagOpen(false)
                setTagName("")
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              {t("common.cancel")}
            </Button>
          </div>
        ) : (
          <Button
            className="w-fit"
            onClick={() => setNewTagOpen(true)}
            size="sm"
            type="button"
            variant="outline"
          >
            <PlusIcon aria-hidden="true" className="size-4" />
            {t("accessA.accordion.newTag")}
          </Button>
        )
      ) : null}
    </div>
  )
}

/* -------------------------------------------------------------- user groups */

function avatarName(member: { email: string; displayName: string | null }): string {
  return member.displayName?.trim() || member.email
}

function UserGroupsBody({
  subjects,
  canEdit,
  refresh,
}: {
  subjects: AccessSubjects
  canEdit: boolean
  refresh: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [openMemberFor, setOpenMemberFor] = useState<string | null>(null)
  const [email, setEmail] = useState("")
  const [groupName, setGroupName] = useState("")
  const [newGroupOpen, setNewGroupOpen] = useState(false)
  const [error, setError] = useState<string>()
  const createGroup = useCreateUserGroup()
  const deleteGroup = useDeleteUserGroup()
  const addMember = useAddUserGroupMember()
  const removeMember = useRemoveUserGroupMember()

  const fail = (cause: unknown) =>
    setError(cause instanceof Error ? cause.message : t("common.error"))

  return (
    <div className="flex flex-col gap-2.5">
      <InlineError message={error} />
      {subjects.userGroups.length === 0 ? (
        <p className="text-[13px] text-fg-2">{t("accessA.accordion.noGroups")}</p>
      ) : null}
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {subjects.userGroups.map((group) => (
          <UserGroupCard
            addMember={addMember}
            canEdit={canEdit}
            deleteGroup={deleteGroup}
            email={email}
            error={fail}
            group={group}
            key={group.id}
            openMemberFor={openMemberFor}
            refresh={refresh}
            removeMember={removeMember}
            setEmail={setEmail}
            setError={setError}
            setOpenMemberFor={setOpenMemberFor}
          />
        ))}
      </div>

      {canEdit ? (
        newGroupOpen ? (
          <div className="flex flex-wrap items-center gap-2">
            <input
              aria-label={t("accessA.accordion.groupName")}
              className="h-9 min-w-0 flex-1 rounded-lg border-0 bg-card px-2.5 text-sm shadow-[inset_0_0_0_1px_var(--line-2)] outline-0 focus:shadow-[inset_0_0_0_1.5px_var(--brand),0_0_0_3px_var(--brand-soft)] sm:max-w-60"
              onChange={(event) => setGroupName(event.target.value)}
              placeholder={t("accessA.accordion.groupName")}
              value={groupName}
            />
            <Button
              disabled={createGroup.isPending || groupName.trim() === ""}
              onClick={() => {
                setError(undefined)
                createGroup.mutate(
                  { data: { name: groupName.trim(), source: "manual" } },
                  {
                    onSuccess: () => {
                      setGroupName("")
                      setNewGroupOpen(false)
                      void refresh()
                    },
                    onError: fail,
                  }
                )
              }}
              size="sm"
              type="button"
            >
              {t("accessA.accordion.create")}
            </Button>
            <Button
              onClick={() => {
                setNewGroupOpen(false)
                setGroupName("")
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              {t("common.cancel")}
            </Button>
          </div>
        ) : (
          <Button
            className="w-fit"
            onClick={() => setNewGroupOpen(true)}
            size="sm"
            type="button"
            variant="outline"
          >
            <PlusIcon aria-hidden="true" className="size-4" />
            {t("accessA.accordion.newGroup")}
          </Button>
        )
      ) : null}
    </div>
  )
}

function UserGroupCard({
  group,
  canEdit,
  email,
  setEmail,
  openMemberFor,
  setOpenMemberFor,
  setError,
  error,
  refresh,
  addMember,
  removeMember,
  deleteGroup,
}: {
  group: AccessUserGroup
  canEdit: boolean
  email: string
  setEmail: (value: string) => void
  openMemberFor: string | null
  setOpenMemberFor: (value: string | null) => void
  setError: (value?: string) => void
  error: (cause: unknown) => void
  refresh: () => Promise<void>
  addMember: ReturnType<typeof useAddUserGroupMember>
  removeMember: ReturnType<typeof useRemoveUserGroupMember>
  deleteGroup: ReturnType<typeof useDeleteUserGroup>
}) {
  const { t } = useTranslation()
  const manual = group.source === "manual" && !group.readOnly
  const open = openMemberFor === group.id

  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-[10px] bg-surface-2 p-2.5 shadow-[inset_0_0_0_1px_var(--line)]">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <GroupChip name={group.name} />
        <span className="inline-flex h-5 items-center rounded-[5px] bg-surface-3 px-1.5 text-[12px] font-semibold text-fg-2">
          {group.source === "oidc"
            ? t("accessA.accordion.sourceOidc")
            : t("accessA.accordion.sourceManual")}
        </span>
        <span className="text-[12.5px] leading-[18px] text-fg-2">
          {t("accessA.accordion.people", { count: group.peopleCount })}
          {" · "}
          {t("accessA.accordion.devices", { count: group.deviceCount })}
        </span>
        {canEdit && manual ? (
          <button
            aria-label={t("accessA.accordion.deleteGroup", { name: group.name })}
            className="ml-auto grid size-7 flex-none place-items-center rounded-md text-fg-3 hover:bg-err-soft hover:text-err focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            disabled={deleteGroup.isPending}
            onClick={() => {
              setError(undefined)
              deleteGroup.mutate(
                { groupId: group.id },
                { onSuccess: () => void refresh(), onError: error }
              )
            }}
            type="button"
          >
            <Trash2Icon aria-hidden="true" className="size-4" />
          </button>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-col gap-0.5">
        {group.members.map((member) => (
          <div
            className="flex min-h-7 min-w-0 items-center gap-2 text-[12.5px] leading-[18px]"
            key={member.email}
          >
            <span
              aria-hidden="true"
              className="grid size-[22px] flex-none place-items-center rounded-full bg-surface-3 text-[9px] font-semibold text-fg-2"
            >
              {initials(avatarName(member), member.email)}
            </span>
            <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{member.email}</span>
            {group.readOnly ? (
              <LockIcon
                aria-label={t("accessA.accordion.readOnly")}
                className="size-3.5 flex-none text-fg-3"
                role="img"
              />
            ) : null}
            {canEdit && manual ? (
              <button
                aria-label={t("accessA.accordion.removeMember", { email: member.email })}
                className="grid size-6 flex-none place-items-center rounded-md text-fg-3 hover:bg-err-soft hover:text-err focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                disabled={removeMember.isPending}
                onClick={() => {
                  setError(undefined)
                  removeMember.mutate(
                    { groupId: group.id, email: member.email },
                    { onSuccess: () => void refresh(), onError: error }
                  )
                }}
                type="button"
              >
                <XIcon aria-hidden="true" className="size-3.5" />
              </button>
            ) : null}
          </div>
        ))}
      </div>

      {canEdit && manual ? (
        open ? (
          <div className="flex flex-wrap items-center gap-2">
            <input
              aria-label={t("accessA.accordion.memberEmail")}
              className="h-9 min-w-0 flex-1 rounded-lg border-0 bg-card px-2.5 text-sm shadow-[inset_0_0_0_1px_var(--line-2)] outline-0 focus:shadow-[inset_0_0_0_1.5px_var(--brand),0_0_0_3px_var(--brand-soft)]"
              inputMode="email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder={t("accessA.accordion.memberEmail")}
              type="email"
              value={email}
            />
            <Button
              disabled={addMember.isPending || email.trim() === ""}
              onClick={() => {
                setError(undefined)
                addMember.mutate(
                  { groupId: group.id, data: { email: email.trim() } },
                  {
                    onSuccess: () => {
                      setEmail("")
                      setOpenMemberFor(null)
                      void refresh()
                    },
                    onError: error,
                  }
                )
              }}
              size="sm"
              type="button"
            >
              {t("common.add")}
            </Button>
          </div>
        ) : (
          <Button
            className="w-fit"
            onClick={() => setOpenMemberFor(group.id)}
            size="sm"
            type="button"
            variant="secondary"
          >
            <PlusIcon aria-hidden="true" className="size-4" />
            {t("accessA.accordion.addMember")}
          </Button>
        )
      ) : null}
    </div>
  )
}

/* --------------------------------------------------------------- test access */

function chainLabel(chain: string, t: (key: string) => string): string {
  if (chain === "inbound" || chain === "outbound" || chain === "forward") {
    return t(`accessA.defaults.${chain as AccessChainName}`)
  }
  return chain
}

function TestAccessBody({
  subjects,
  networkId,
  canEdit,
}: {
  subjects: AccessSubjects
  networkId: string
  canEdit: boolean
}) {
  const { t } = useTranslation()
  const devices = subjects.devices.filter((device) => device.state === "approved")
  const subnets = accessSubnets(subjects)
  const [src, setSrc] = useState("")
  const [dst, setDst] = useState("")
  const [protocol, setProtocol] = useState<TestNetworkReachabilityBodyProtocol>("tcp")
  const [port, setPort] = useState("22")
  const [error, setError] = useState<string>()
  const test = useTestNetworkReachability()

  const result = test.data?.data.reachability
  const decidingRule = result?.decidedBy
    ? (result.trace.find(
        (entry) =>
          entry.deviceId === result.decidedBy?.deviceId &&
          entry.chain === result.decidedBy?.chain
      )?.matchedRule ?? null)
    : null
  const decide = () => {
    setError(undefined)
    test.mutate(
      {
        networkId,
        data: {
          ...(src ? { srcDeviceId: src } : {}),
          ...(dst.startsWith("cidr:")
            ? { dstCidr: dst.slice("cidr:".length) }
            : dst
              ? { dstDeviceId: dst }
              : {}),
          protocol,
          ...(protocol === "icmp" || protocol === "icmpv6"
            ? {}
            : port
              ? { port: Number(port) }
              : {}),
        },
      },
      {
        onError: (cause) =>
          setError(cause instanceof Error ? cause.message : t("common.error")),
      }
    )
  }

  return (
    <div className="flex flex-col gap-2.5">
      <InlineError message={error} />
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <label className="min-w-0">
          <span className="mb-1 block text-[12.5px] font-medium text-fg-2">
            {t("accessA.accordion.from")}
          </span>
          <select
            aria-label={t("accessA.accordion.from")}
            className="h-9 w-full min-w-0 rounded-lg border border-line-2 bg-card px-2 text-sm text-foreground outline-none focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand-soft disabled:bg-surface-2 max-sm:h-12 max-sm:text-base"
            disabled={!canEdit}
            onChange={(event) => {
              test.reset()
              setSrc(event.target.value)
            }}
            value={src}
          >
            <option value="">{t("accessA.accordion.choose")}</option>
            {devices.map((device) => (
              <option key={device.id} value={device.id}>
                {device.name}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0">
          <span className="mb-1 block text-[12.5px] font-medium text-fg-2">
            {t("accessA.accordion.to")}
          </span>
          <select
            aria-label={t("accessA.accordion.to")}
            className="h-9 w-full min-w-0 rounded-lg border border-line-2 bg-card px-2 text-sm text-foreground outline-none focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand-soft disabled:bg-surface-2 max-sm:h-12 max-sm:text-base"
            disabled={!canEdit}
            onChange={(event) => {
              test.reset()
              setDst(event.target.value)
            }}
            value={dst}
          >
            <option value="">{t("accessA.accordion.choose")}</option>
            {devices.map((device) => (
              <option key={device.id} value={device.id}>
                {device.name}
              </option>
            ))}
            {subnets.map((subnet) => (
              <option key={`${subnet.id}-${subnet.cidr}`} value={`cidr:${subnet.cidr}`}>
                {`${subnet.name} (${subnet.cidr})`}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0">
          <span className="mb-1 block text-[12.5px] font-medium text-fg-2">
            {t("accessA.accordion.protocol")}
          </span>
          <select
            aria-label={t("accessA.accordion.protocol")}
            className="h-9 w-full min-w-0 rounded-lg border border-line-2 bg-card px-2 text-sm text-foreground outline-none focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand-soft disabled:bg-surface-2 max-sm:h-12 max-sm:text-base"
            disabled={!canEdit}
            onChange={(event) => {
              test.reset()
              setProtocol(event.target.value as TestNetworkReachabilityBodyProtocol)
            }}
            value={protocol}
          >
            <option value="tcp">TCP</option>
            <option value="udp">UDP</option>
            <option value="icmp">ICMP</option>
            <option value="icmpv6">ICMPv6</option>
          </select>
        </label>
        <label className="min-w-0">
          <span className="mb-1 block text-[12.5px] font-medium text-fg-2">
            {t("accessA.accordion.port")}
          </span>
          <input
            aria-label={t("accessA.accordion.port")}
            className="h-9 w-full min-w-0 rounded-lg border border-line-2 bg-card px-2 font-mono text-sm text-foreground outline-none focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand-soft disabled:bg-surface-2 max-sm:h-12 max-sm:text-base"
            disabled={!canEdit || protocol === "icmp" || protocol === "icmpv6"}
            inputMode="numeric"
            onChange={(event) => {
              test.reset()
              setPort(event.target.value.replace(/[^\d]/g, ""))
            }}
            value={port}
          />
        </label>
      </div>
      <Button
        className="w-fit"
        disabled={!canEdit || test.isPending || !src || !dst}
        onClick={decide}
        size="sm"
        type="button"
        variant="outline"
      >
        {test.isPending ? t("common.loading") : t("accessA.accordion.run")}
      </Button>

      {result ? (
        <div
          className={cn(
            "flex min-w-0 items-start gap-2 rounded-lg px-2.5 py-2 text-[13px] leading-[18px] shadow-[inset_0_0_0_1px_var(--line)]",
            result.allowed ? "bg-ok-soft" : "bg-err-soft"
          )}
          role="status"
        >
          {result.allowed ? (
            <CheckCircle2Icon aria-hidden="true" className="mt-0.5 size-4 flex-none text-ok" />
          ) : (
            <XCircleIcon aria-hidden="true" className="mt-0.5 size-4 flex-none text-err" />
          )}
          <div className="min-w-0">
            <p className="font-medium">
              {result.allowed ? t("accessA.accordion.allowed") : t("accessA.accordion.denied")}
            </p>
            {result.decidedBy ? (
              <p className="text-fg-2 [overflow-wrap:anywhere]">
                {decidingRule
                  ? t("accessA.accordion.decidedBy", {
                      device: result.decidedBy.hostname,
                      chain: chainLabel(result.decidedBy.chain, t),
                      rule: decidingRule,
                    })
                  : t("accessA.accordion.decidedByDefault", {
                      device: result.decidedBy.hostname,
                      chain: chainLabel(result.decidedBy.chain, t),
                    })}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

/* -------------------------------------------------------------- compiled ACL */

function compiledAclText(
  data: GetCompiledAcl200 | undefined,
  noRules: string
): string {
  if (!data) return ""
  const header = [
    data.hostname,
    data.virtualIpv4 ?? "",
    `policy v${data.policyVersion}`,
    data.mode,
  ]
    .filter(Boolean)
    .join("  ")
  const chains = data.chains.map((chain) => {
    const lines = [
      `${chain.name}  enabled: ${chain.enabled}  default_action: ${chain.defaultAction}`,
    ]
    if (chain.rules.length === 0) {
      lines.push(`  ${noRules}`)
    }
    for (const rule of chain.rules) {
      lines.push(
        `  ${rule.name}  priority ${rule.priority}  ${rule.action}  ${rule.protocol}  ports ${JSON.stringify(
          rule.ports
        )}  ${JSON.stringify(rule.sourceIps)} -> ${JSON.stringify(
          rule.destinationIps
        )}  source_ports ${JSON.stringify(rule.sourcePorts)}  stateful: ${rule.stateful}`
      )
    }
    return lines.join("\n")
  })
  return [header, ...chains].join("\n\n")
}

function CompiledAclBody({
  subjects,
  networkId,
}: {
  subjects: AccessSubjects
  networkId: string
}) {
  const { t } = useTranslation()
  const devices = subjects.devices.filter((device) => device.state === "approved")
  const [deviceId, setDeviceId] = useState(devices[0]?.id ?? "")
  const chosen = devices.some((device) => device.id === deviceId)
    ? deviceId
    : (devices[0]?.id ?? "")
  const compiled = useGetCompiledAcl(networkId, chosen, {
    query: { enabled: Boolean(chosen) },
  })
  const text = compiledAclText(compiled.data?.data, t("accessA.accordion.compiledNoRules"))

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <label className="min-w-0 sm:max-w-72">
        <span className="mb-1 block text-[12.5px] font-medium text-fg-2">
          {t("accessA.accordion.compiledDevice")}
        </span>
        <select
          aria-label={t("accessA.accordion.compiledDevice")}
          className="h-9 w-full min-w-0 rounded-lg border border-line-2 bg-card px-2 text-sm text-foreground outline-none focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand-soft max-sm:h-12 max-sm:text-base"
          onChange={(event) => setDeviceId(event.target.value)}
          value={chosen}
        >
          {devices.length === 0 ? (
            <option value="">{t("common.empty")}</option>
          ) : null}
          {devices.map((device) => (
            <option key={device.id} value={device.id}>
              {device.name}
            </option>
          ))}
        </select>
      </label>
      {chosen && text ? (
        <pre
          className="min-w-0 rounded-lg bg-surface-2 p-2.5 font-mono text-[12.5px] leading-[18px] whitespace-pre-wrap [overflow-wrap:anywhere] shadow-[inset_0_0_0_1px_var(--line)]"
          data-testid="compiled-acl-output"
        >
          {text}
        </pre>
      ) : (
        <p className="text-[13px] text-fg-2">
          {compiled.isLoading ? t("common.loading") : t("accessA.accordion.compiledEmpty")}
        </p>
      )}
    </div>
  )
}

/* ------------------------------------------------------------ policy version */

function PolicyVersionBody({
  mode,
  versions,
  users,
}: {
  mode: AccessMode
  versions: ListNetworkPolicyVersions200Item[]
  users: ListUsers200Item[]
}) {
  const { t, i18n } = useTranslation()
  const [historyOpen, setHistoryOpen] = useState(false)
  const latest = versions[0]
  const userName = (createdBy: string | null) => {
    if (!createdBy) return "—"
    const user = users.find((entry) => entry.id === createdBy)
    return user?.displayName || user?.email || "—"
  }

  return (
    <div className="flex flex-col gap-2">
      {latest ? (
        <p className="text-[12.5px] leading-[18px] text-fg-2">
          {t("accessA.accordion.versionLine", {
            action:
              mode === "open"
                ? t("accessA.accordion.disablePolicy")
                : t("accessA.accordion.enablePolicy"),
            user: userName(latest.createdBy),
            time: formatRelativeTime(latest.createdAt, i18n.language) ?? latest.createdAt,
          })}
        </p>
      ) : (
        <p className="text-[12.5px] leading-[18px] text-fg-2">
          {t("accessA.accordion.noVersion")}
        </p>
      )}
      <Button
        className="w-fit"
        onClick={() => setHistoryOpen(true)}
        size="sm"
        type="button"
        variant="outline"
      >
        <HistoryIcon aria-hidden="true" className="size-4" />
        {t("accessA.accordion.history")}
      </Button>

      <Dialog onOpenChange={setHistoryOpen} open={historyOpen}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>{t("accessA.accordion.historyTitle")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col divide-y divide-line">
            {versions.map((version) => (
              <div className="flex min-w-0 flex-col gap-0.5 py-2 text-[12.5px]" key={version.id}>
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-mono font-semibold">#{version.version}</span>
                  <span className="text-fg-2">
                    {t("accessA.accordion.versionTableStatements")}:{" "}
                    {version.summary.statements}
                  </span>
                  <span className="ml-auto text-fg-2">
                    {formatRelativeTime(version.createdAt, i18n.language) ??
                      version.createdAt}
                  </span>
                </div>
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-fg-3">
                    {t("accessA.accordion.versionTableBy")}: {userName(version.createdBy)}
                  </span>
                  {version.note ? (
                    <span className="min-w-0 text-fg-2 [overflow-wrap:anywhere]">
                      {version.note}
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/* ----------------------------------------------------------------- accordion */

export function AccessAccordions({
  subjects,
  networkId,
  canEdit,
  mode,
  versions,
  users,
  refresh,
}: {
  subjects: AccessSubjects
  networkId: string
  canEdit: boolean
  mode: AccessMode
  versions: ListNetworkPolicyVersions200Item[]
  users: ListUsers200Item[]
  refresh: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState<AccordionKey | null>(null)
  const toggle = (key: AccordionKey) => setOpen((current) => (current === key ? null : key))

  const subnets = useMemo(() => accessSubnets(subjects), [subjects])

  return (
    <div className="min-w-0 rounded-xl bg-card shadow-sm ring-1 ring-line">
      <AccordionItem
        count={subnets.length}
        icon={<NetworkIcon className="size-4" />}
        id="subnets"
        onToggle={() => toggle("subnets")}
        open={open === "subnets"}
        title={t("accessA.accordion.subnets")}
      >
        <SubnetsBody subjects={subjects} />
      </AccordionItem>

      <AccordionItem
        count={subjects.tags.length}
        icon={<TagIcon className="size-4 text-[var(--tag-fg)]" />}
        id="tags"
        onToggle={() => toggle("tags")}
        open={open === "tags"}
        title={t("accessA.accordion.tags")}
      >
        <TagsBody canEdit={canEdit} refresh={refresh} subjects={subjects} />
      </AccordionItem>

      <AccordionItem
        count={subjects.userGroups.length}
        icon={<UsersIcon className="size-4 text-[var(--ug-fg)]" />}
        id="groups"
        onToggle={() => toggle("groups")}
        open={open === "groups"}
        title={t("accessA.accordion.groups")}
      >
        <UserGroupsBody canEdit={canEdit} refresh={refresh} subjects={subjects} />
      </AccordionItem>

      <AccordionItem
        icon={<CheckCircle2Icon className="size-4" />}
        id="test"
        onToggle={() => toggle("test")}
        open={open === "test"}
        title={t("accessA.accordion.test")}
      >
        <TestAccessBody canEdit={canEdit} networkId={networkId} subjects={subjects} />
      </AccordionItem>

      <AccordionItem
        icon={<SquareTerminalIcon className="size-4" />}
        id="compiled"
        onToggle={() => toggle("compiled")}
        open={open === "compiled"}
        title={t("accessA.accordion.compiled")}
      >
        <CompiledAclBody networkId={networkId} subjects={subjects} />
      </AccordionItem>

      <AccordionItem
        icon={<HistoryIcon className="size-4" />}
        id="version"
        onToggle={() => toggle("version")}
        open={open === "version"}
        title={
          versions.length > 0
            ? t("accessA.accordion.versionNumber", { version: versions[0]!.version })
            : t("accessA.accordion.version")
        }
      >
        <PolicyVersionBody mode={mode} users={users} versions={versions} />
      </AccordionItem>
    </div>
  )
}
