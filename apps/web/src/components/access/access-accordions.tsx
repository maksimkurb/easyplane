import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import type { TFunction } from "i18next"
import {
  BracesIcon,
  CheckCircle2Icon,
  HistoryIcon,
  LockIcon,
  NetworkIcon,
  PlusIcon,
  RotateCcwIcon,
  SquareTerminalIcon,
  TagIcon,
  Trash2Icon,
  UsersIcon,
  WrenchIcon,
  XCircleIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

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
  useSaveNetworkPolicy,
  useTestNetworkReachability,
} from "@/api/generated/easyplane"
import type { TestNetworkReachabilityBodyProtocol } from "@/api/generated/model"
import type {
  AccessDocument,
  AccessMode,
  AccessRule,
  AccessSubjects,
  AccessUserGroup,
} from "@/lib/access-policy"
import { normalizeAccessDocument } from "@/lib/access-policy"
import { formatRelativeTime } from "@/lib/format"
import { initials } from "@/lib/initials"
import { Button } from "@/components/ui/button"
import { OptionSelect } from "@/components/shared/option-select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  GroupChip,
  PlainDeviceChip,
  TagChip,
} from "@/components/access/access-chips"
import {
  friendlyChainName,
  isGeneratedRuleName,
  prettySubnetName,
  ruleChangeSentence,
  ruleDisplayTitle,
  ruleIndexForCompiledName,
} from "@/components/access/access-rule-summary"
import { cn } from "@/lib/utils"

function InlineError({ message }: { message?: string }) {
  if (!message) return null
  return (
    <p
      aria-live="assertive"
      className="text-[12.5px] leading-[18px] text-err"
      role="alert"
    >
      {message}
    </p>
  )
}

function accessSubnets(subjects: AccessSubjects) {
  return subjects.subnets.filter((subnet) => subnet.approved)
}

/* ------------------------------------------------------------------ subnets */

export function AccessSubnets({ subjects }: { subjects: AccessSubjects }) {
  const { t } = useTranslation()
  const subnets = useMemo(() => accessSubnets(subjects), [subjects])
  return (
    <section className="min-w-0 rounded-xl bg-card p-3 shadow-sm ring-1 ring-line">
      <div className="mb-2 flex items-center gap-2">
        <NetworkIcon aria-hidden="true" className="size-4 text-fg-3" />
        <h2 className="text-[15px] leading-5 font-semibold">
          {t("accessA.accordion.subnets")}
        </h2>
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-surface-2 px-1.5 text-[12px] font-medium text-fg-2 tabular-nums">
          {subnets.length}
        </span>
      </div>
      <p className="mb-2 text-[12.5px] leading-[18px] text-fg-2">
        {t("accessA.accordion.subnetsHint")}
      </p>
      {subnets.length === 0 ? (
        <p className="text-[13px] text-fg-2">
          {t("accessA.accordion.noSubnets")}
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {subnets.map((subnet) => {
            const pretty = prettySubnetName(
              subnet.name,
              subnet.cidr,
              subnet.viaHostname
            )
            return (
              <div
                className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-lg bg-surface-2 px-2.5 py-2 text-sm"
                key={`${subnet.id}-${subnet.cidr}`}
              >
                {!pretty.auto ? (
                  <span className="font-medium">{pretty.label}</span>
                ) : null}
                <span className="font-mono text-[12.5px] whitespace-nowrap text-fg-2">
                  {subnet.cidr}
                </span>
                {pretty.via ? (
                  <span className="text-[12.5px] text-fg-2">
                    {t("accessA.accordion.via", { device: pretty.via })}
                  </span>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
    </section>
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
  const devices = subjects.devices.filter(
    (device) => device.state === "approved"
  )

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
                    aria-label={t("accessA.accordion.deleteTag", {
                      name: tag.name,
                    })}
                    className="ml-auto grid size-7 flex-none place-items-center rounded-md text-fg-2 hover:bg-err-soft hover:text-err focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none max-sm:size-11"
                    disabled={deleteTag.isPending}
                    onClick={() => {
                      setError(undefined)
                      deleteTag.mutate(
                        { tagId: tag.id },
                        { onSuccess: () => void refresh(), onError: fail }
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
                  <PlainDeviceChip
                    key={device.id}
                    name={device.name}
                    wireguard={device.kind === "wireguard"}
                  />
                ))}
                {canEdit ? (
                  <button
                    aria-expanded={open}
                    className="inline-flex min-h-6 items-center gap-1 rounded-[7px] bg-card px-2 text-[13px] text-fg-2 shadow-[inset_0_0_0_1px_var(--line)] hover:bg-surface-3 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none max-sm:min-h-11"
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
                    const checked = tag.devices.some(
                      (entry) => entry.id === device.id
                    )
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
                              : [
                                  ...tag.devices.map((entry) => entry.id),
                                  device.id,
                                ]
                            setError(undefined)
                            assign.mutate(
                              { tagId: tag.id, data: { deviceIds: ids } },
                              { onSuccess: () => void refresh(), onError: fail }
                            )
                          }}
                          type="checkbox"
                        />
                        <span className="min-w-0 [overflow-wrap:anywhere]">
                          {device.name}
                        </span>
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

function avatarName(member: {
  email: string
  displayName: string | null
}): string {
  return member.displayName?.trim() || member.email
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
            aria-label={t("accessA.accordion.deleteGroup", {
              name: group.name,
            })}
            className="ml-auto grid size-7 flex-none place-items-center rounded-md text-fg-2 hover:bg-err-soft hover:text-err focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none max-sm:size-11"
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
            <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
              {member.email}
            </span>
            {group.readOnly ? (
              <LockIcon
                aria-label={t("accessA.accordion.readOnly")}
                className="size-3.5 flex-none text-fg-3"
                role="img"
              />
            ) : null}
            {canEdit && manual ? (
              <button
                aria-label={t("accessA.accordion.removeMember", {
                  email: member.email,
                })}
                className="grid size-6 flex-none place-items-center rounded-md text-fg-2 hover:bg-err-soft hover:text-err focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none max-sm:size-11"
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
        <p className="text-[13px] text-fg-2">
          {t("accessA.accordion.noGroups")}
        </p>
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

export function AccessTagsGroups({
  subjects,
  canEdit,
  refresh,
}: {
  subjects: AccessSubjects
  canEdit: boolean
  refresh: () => Promise<void>
}) {
  const { t } = useTranslation()
  return (
    <div
      className="flex min-w-0 flex-col gap-3"
      data-testid="access-tags-groups"
    >
      <section className="min-w-0 rounded-xl bg-card p-3 shadow-sm ring-1 ring-line">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <TagIcon aria-hidden="true" className="size-4 text-[var(--tag-fg)]" />
          <h2 className="text-[15px] leading-5 font-semibold">
            {t("accessA.accordion.tags")}
          </h2>
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-surface-2 px-1.5 text-[12px] font-medium text-fg-2 tabular-nums">
            {subjects.tags.length}
          </span>
        </div>
        <p className="mb-2 text-[12.5px] leading-[18px] text-fg-2">
          {t("accessA.accordion.tagsHint")}
        </p>
        <TagsBody canEdit={canEdit} refresh={refresh} subjects={subjects} />
      </section>

      <section className="min-w-0 rounded-xl bg-card p-3 shadow-sm ring-1 ring-line">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <UsersIcon
            aria-hidden="true"
            className="size-4 text-[var(--ug-fg)]"
          />
          <h2 className="text-[15px] leading-5 font-semibold">
            {t("accessA.accordion.groups")}
          </h2>
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-surface-2 px-1.5 text-[12px] font-medium text-fg-2 tabular-nums">
            {subjects.userGroups.length}
          </span>
        </div>
        <p className="mb-2 text-[12.5px] leading-[18px] text-fg-2">
          {t("accessA.accordion.groupsHint")}
        </p>
        <UserGroupsBody
          canEdit={canEdit}
          refresh={refresh}
          subjects={subjects}
        />
      </section>
    </div>
  )
}

/* --------------------------------------------------------------- test access */

function TestAccessForm({
  subjects,
  networkId,
  rules,
  canTest,
  onResult,
}: {
  subjects: AccessSubjects
  networkId: string
  rules: AccessRule[]
  canTest: boolean
  onResult: (index: number | null) => void
}) {
  const { t } = useTranslation()
  const devices = subjects.devices.filter(
    (device) => device.state === "approved"
  )
  const subnets = accessSubnets(subjects)
  const [src, setSrc] = useState("")
  const [dst, setDst] = useState("")
  const [protocol, setProtocol] =
    useState<TestNetworkReachabilityBodyProtocol>("tcp")
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
  const decidingIndex = ruleIndexForCompiledName(rules, decidingRule)
  const decidingTitle =
    decidingIndex !== null
      ? ruleDisplayTitle(rules[decidingIndex]!, subjects, t)
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
        onSuccess: (response) => {
          const reachability = response.data.reachability
          const matched = reachability.decidedBy
            ? (reachability.trace.find(
                (entry) =>
                  entry.deviceId === reachability.decidedBy?.deviceId &&
                  entry.chain === reachability.decidedBy?.chain
              )?.matchedRule ?? null)
            : null
          onResult(ruleIndexForCompiledName(rules, matched))
        },
        onError: (cause) =>
          setError(cause instanceof Error ? cause.message : t("common.error")),
      }
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <InlineError message={error} />
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="min-w-0">
          <span className="mb-1 block text-[12.5px] font-medium text-fg-2">
            {t("accessA.accordion.from")}
          </span>
          <OptionSelect
            aria-label={t("accessA.accordion.from")}
            disabled={!canTest}
            empty={<span>{t("accessA.test.noDevices")}</span>}
            onValueChange={(value) => {
              test.reset()
              onResult(null)
              setSrc(value)
            }}
            options={devices.map((device) => ({
              value: device.id,
              label: device.name,
            }))}
            placeholder={t("accessA.accordion.choose")}
            triggerClassName="max-w-none"
            value={src}
          />
        </div>
        <div className="min-w-0">
          <span className="mb-1 block text-[12.5px] font-medium text-fg-2">
            {t("accessA.accordion.to")}
          </span>
          <OptionSelect
            aria-label={t("accessA.accordion.to")}
            disabled={!canTest}
            empty={<span>{t("accessA.test.noDevices")}</span>}
            onValueChange={(value) => {
              test.reset()
              onResult(null)
              setDst(value)
            }}
            options={[
              ...devices.map((device) => ({
                value: device.id,
                label: device.name,
              })),
              ...subnets.map((subnet) => {
                const pretty = prettySubnetName(
                  subnet.name,
                  subnet.cidr,
                  subnet.viaHostname
                )
                return {
                  value: `cidr:${subnet.cidr}`,
                  label: pretty.auto
                    ? pretty.via
                      ? t("accessA.picker.subnetVia", {
                          cidr: pretty.label,
                          device: pretty.via,
                        })
                      : pretty.label
                    : subnet.name,
                }
              }),
            ]}
            placeholder={t("accessA.accordion.choose")}
            triggerClassName="max-w-none"
            value={dst}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-32 min-w-0 flex-none">
          <span className="mb-1 block text-[12.5px] font-medium text-fg-2">
            {t("accessA.accordion.protocol")}
          </span>
          <OptionSelect
            aria-label={t("accessA.accordion.protocol")}
            disabled={!canTest}
            onValueChange={(value) => {
              test.reset()
              onResult(null)
              setProtocol(value as TestNetworkReachabilityBodyProtocol)
            }}
            options={[
              { value: "tcp", label: "TCP" },
              { value: "udp", label: "UDP" },
              { value: "icmp", label: "ICMP" },
              { value: "icmpv6", label: "ICMPv6" },
            ]}
            triggerClassName="max-w-none"
            value={protocol}
          />
        </div>
        <label className="w-28 min-w-0 flex-none">
          <span className="mb-1 block text-[12.5px] font-medium text-fg-2">
            {t("accessA.accordion.port")}
          </span>
          <input
            aria-label={t("accessA.accordion.port")}
            className="h-10 w-full min-w-0 rounded-lg border border-line-2 bg-card px-2 font-mono text-sm text-foreground outline-none focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand-soft disabled:bg-surface-2 max-sm:h-12 max-sm:text-base"
            disabled={!canTest || protocol === "icmp" || protocol === "icmpv6"}
            inputMode="numeric"
            onChange={(event) => {
              test.reset()
              onResult(null)
              setPort(event.target.value.replace(/[^\d]/g, ""))
            }}
            value={port}
          />
        </label>
        <Button
          disabled={!canTest || test.isPending || !src || !dst}
          onClick={decide}
          size="sm"
          type="button"
        >
          {test.isPending ? t("common.loading") : t("accessA.accordion.run")}
        </Button>
      </div>
      {protocol === "icmp" || protocol === "icmpv6" ? (
        <p className="text-[12px] leading-[18px] text-fg-2">
          {t("accessA.test.icmpHint")}
        </p>
      ) : null}

      {result ? (
        <div
          className={cn(
            "flex min-w-0 items-start gap-2 rounded-lg px-2.5 py-2 text-[13px] leading-[18px] shadow-[inset_0_0_0_1px_var(--line)]",
            result.allowed ? "bg-ok-soft" : "bg-err-soft"
          )}
          data-testid="test-access-result"
          role="status"
        >
          {result.allowed ? (
            <CheckCircle2Icon
              aria-hidden="true"
              className="mt-0.5 size-4 flex-none text-ok"
            />
          ) : (
            <XCircleIcon
              aria-hidden="true"
              className="mt-0.5 size-4 flex-none text-err"
            />
          )}
          <div className="min-w-0">
            <p className="font-medium">
              {result.allowed
                ? t("accessA.accordion.allowed")
                : t("accessA.accordion.denied")}
            </p>
            {result.decidedBy ? (
              <p className="[overflow-wrap:anywhere] text-fg-2">
                {decidingTitle
                  ? t("accessA.accordion.decidedBy", {
                      device: result.decidedBy.hostname,
                      chain: friendlyChainName(result.decidedBy.chain, t),
                      rule: decidingTitle,
                    })
                  : t("accessA.accordion.decidedByDefault", {
                      device: result.decidedBy.hostname,
                      chain: friendlyChainName(result.decidedBy.chain, t),
                    })}
              </p>
            ) : null}
            {decidingTitle ? (
              <p className="mt-1 text-[12px] text-fg-2">
                {t("accessA.test.highlighted")}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

/* -------------------------------------------------------------- compiled ACL */

function chainTitle(chain: string, t: TFunction): string {
  return friendlyChainName(chain, t)
}

function compiledAclText(
  data: GetCompiledAcl200 | undefined,
  t: TFunction
): string {
  if (!data) return ""
  const header = [
    data.hostname,
    data.virtualIpv4 ?? "",
    t("accessA.compiled.policyVersion", { version: data.policyVersion }),
    data.mode === "open"
      ? t("accessA.history.modeOpen")
      : t("accessA.history.modeRules"),
  ]
    .filter(Boolean)
    .join("  ")
  const chains = data.chains.map((chain) => {
    const lines = [
      `${chainTitle(chain.name, t)}  ·  ${
        chain.enabled
          ? t("accessA.compiled.enabled")
          : t("accessA.compiled.disabled")
      }  ·  ${t("accessA.compiled.defaultAction", {
        action:
          chain.defaultAction === "Allow"
            ? t("accessA.defaults.allow")
            : t("accessA.defaults.block"),
      })}`,
    ]
    if (chain.rules.length === 0) {
      lines.push(`  ${t("accessA.compiled.noRules")}`)
    }
    for (const rule of chain.rules) {
      const source = rule.sourceIps.length
        ? rule.sourceIps.join(", ")
        : t("accessA.compiled.anyone")
      const destination = rule.destinationIps.length
        ? rule.destinationIps.join(", ")
        : t("accessA.compiled.anywhere")
      const parts = [
        `  ${rule.name}`,
        t("accessA.compiled.priority", { priority: rule.priority }),
        rule.action === "Allow"
          ? t("accessA.defaults.allow")
          : t("accessA.defaults.block"),
        rule.protocol.toUpperCase(),
        rule.ports.length
          ? t("accessA.compiled.ports", { ports: rule.ports.join(", ") })
          : t("accessA.ports.any"),
        `${source} → ${destination}`,
        rule.stateful
          ? t("accessA.compiled.statefulOn")
          : t("accessA.compiled.statefulOff"),
      ]
      lines.push(parts.join("  ·  "))
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
  const devices = subjects.devices.filter(
    (device) => device.state === "approved"
  )
  const [deviceId, setDeviceId] = useState(devices[0]?.id ?? "")
  const chosen = devices.some((device) => device.id === deviceId)
    ? deviceId
    : (devices[0]?.id ?? "")
  const compiled = useGetCompiledAcl(networkId, chosen, {
    query: { enabled: Boolean(chosen) },
  })
  const text = compiledAclText(compiled.data?.data, t)

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="min-w-0 sm:max-w-72">
        <span className="mb-1 block text-[12.5px] font-medium text-fg-2">
          {t("accessA.accordion.compiledDevice")}
        </span>
        <OptionSelect
          aria-label={t("accessA.accordion.compiledDevice")}
          empty={<span>{t("accessA.compiled.noDevices")}</span>}
          onValueChange={setDeviceId}
          options={devices.map((device) => ({
            value: device.id,
            label: device.name,
          }))}
          placeholder={t("accessA.accordion.choose")}
          triggerClassName="max-w-none"
          value={chosen}
        />
      </div>
      {chosen && text ? (
        <pre
          className="min-w-0 rounded-lg bg-surface-2 p-2.5 font-mono text-[12.5px] leading-[18px] [overflow-wrap:anywhere] whitespace-pre-wrap shadow-[inset_0_0_0_1px_var(--line)]"
          data-testid="compiled-acl-output"
        >
          {text}
        </pre>
      ) : (
        <p className="text-[13px] text-fg-2">
          {compiled.isLoading
            ? t("common.loading")
            : t("accessA.accordion.compiledEmpty")}
        </p>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------- history */

type RuleChange = {
  kind: "added" | "removed" | "changed"
  /** A name the user wrote, if there is one. Sentences carry the meaning. */
  label?: string
  before?: string
  after?: string
}

function humanRuleName(rule: AccessRule | undefined): string | undefined {
  const name = rule?.name?.trim()
  if (!name || isGeneratedRuleName(name)) return undefined
  return name
}

function diffDocuments(
  older: AccessDocument | undefined,
  newer: AccessDocument,
  subjects: AccessSubjects,
  t: TFunction
): RuleChange[] {
  const sentence = (rule: AccessRule) => ruleChangeSentence(rule, subjects, t)
  if (!older) {
    return newer.rules.map((rule) => ({
      kind: "added" as const,
      ...(humanRuleName(rule) ? { label: humanRuleName(rule)! } : {}),
      after: sentence(rule),
    }))
  }
  const changes: RuleChange[] = []
  const length = Math.max(older.rules.length, newer.rules.length)
  for (let index = 0; index < length; index += 1) {
    const before = older.rules[index]
    const after = newer.rules[index]
    const label = humanRuleName(after) ?? humanRuleName(before)
    if (!before && after) {
      changes.push({
        kind: "added",
        ...(label ? { label } : {}),
        after: sentence(after),
      })
    } else if (before && !after) {
      changes.push({
        kind: "removed",
        ...(label ? { label } : {}),
        before: sentence(before),
      })
    } else if (
      before &&
      after &&
      JSON.stringify(before) !== JSON.stringify(after)
    ) {
      changes.push({
        kind: "changed",
        ...(label ? { label } : {}),
        before: sentence(before),
        after: sentence(after),
      })
    }
  }
  return changes
}

function diffTone(kind: RuleChange["kind"]): string {
  if (kind === "added") return "bg-ok-soft/60"
  if (kind === "removed") return "bg-err-soft/60"
  return "bg-warn-soft/60"
}

function HistoryDialog({
  open,
  onOpenChange,
  networkId,
  versions,
  users,
  subjects,
  mode,
  canRestore,
  refresh,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  networkId: string
  versions: ListNetworkPolicyVersions200Item[]
  users: ListUsers200Item[]
  subjects: AccessSubjects
  mode: AccessMode
  canRestore: boolean
  refresh: () => Promise<void>
}) {
  const { t, i18n } = useTranslation()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [restore, setRestore] =
    useState<ListNetworkPolicyVersions200Item | null>(null)
  const [error, setError] = useState<string>()
  const save = useSaveNetworkPolicy()
  const selected =
    versions.find((version) => version.id === selectedId) ?? versions[0] ?? null
  const selectedIndex = selected
    ? versions.findIndex((version) => version.id === selected.id)
    : -1
  const olderVersion =
    selectedIndex >= 0 ? versions[selectedIndex + 1] : undefined
  const userLabel = (createdBy: string | null) => {
    if (!createdBy) return "—"
    const user = users.find((entry) => entry.id === createdBy)
    return user?.displayName || user?.email || "—"
  }
  const changes = selected
    ? diffDocuments(
        olderVersion
          ? normalizeAccessDocument(olderVersion.document)
          : undefined,
        normalizeAccessDocument(selected.document),
        subjects,
        t
      )
    : []

  return (
    <>
      <Dialog onOpenChange={onOpenChange} open={open}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>{t("accessA.accordion.historyTitle")}</DialogTitle>
            <DialogDescription>{t("accessA.history.hint")}</DialogDescription>
          </DialogHeader>
          <InlineError message={error} />
          {versions.length === 0 ? (
            <p className="text-[13px] text-fg-2">
              {t("accessA.accordion.noVersion")}
            </p>
          ) : (
            <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
              <div className="flex max-h-[22rem] scroll-p-1.5 flex-col gap-0.5 overflow-y-auto overscroll-contain rounded-lg bg-surface-2 p-1.5">
                {versions.map((version) => {
                  const active = selected?.id === version.id
                  return (
                    <button
                      aria-pressed={active}
                      className={cn(
                        "flex min-h-12 w-full flex-none flex-col items-start gap-0.5 rounded-md px-2 py-2 text-left text-[12.5px] hover:bg-surface-3 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
                        active && "bg-card shadow-[inset_0_0_0_1px_var(--line)]"
                      )}
                      key={version.id}
                      onClick={() => setSelectedId(version.id)}
                      type="button"
                    >
                      <span className="flex w-full flex-wrap items-baseline gap-x-2">
                        <b className="font-mono">#{version.version}</b>
                        <span className="text-fg-2">
                          {t("accessA.accordion.versionTableStatements")}:{" "}
                          {version.summary.statements}
                        </span>
                        <span className="ml-auto text-fg-2">
                          {formatRelativeTime(
                            version.createdAt,
                            i18n.language
                          ) ?? version.createdAt}
                        </span>
                      </span>
                      <span className="text-fg-2">
                        {t("accessA.accordion.versionTableBy")}:{" "}
                        {userLabel(version.createdBy)}
                        {version.note ? ` · ${version.note}` : ""}
                      </span>
                    </button>
                  )
                })}
              </div>

              {selected ? (
                <div className="flex min-w-0 flex-col gap-2">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-mono text-sm font-semibold">
                      #{selected.version}
                    </span>
                    <span className="text-[12.5px] text-fg-2">
                      {olderVersion
                        ? t("accessA.history.comparedTo", {
                            version: olderVersion.version,
                          })
                        : t("accessA.history.firstVersion")}
                    </span>
                  </div>
                  {changes.length === 0 ? (
                    <p className="text-[13px] text-fg-2">
                      {t("accessA.history.noChanges")}
                    </p>
                  ) : (
                    <ul className="flex min-w-0 flex-col gap-1.5">
                      {changes.map((change, index) => (
                        <li
                          className={cn(
                            "min-w-0 rounded-lg px-2.5 py-2 text-[12.5px] leading-[18px]",
                            diffTone(change.kind)
                          )}
                          key={`${change.kind}-${change.label}-${index}`}
                        >
                          <div className="flex flex-wrap items-baseline gap-x-2">
                            <span className="font-semibold">
                              {t(`accessA.history.${change.kind}`)}
                            </span>
                            {change.label ? (
                              <span className="min-w-0 [overflow-wrap:anywhere]">
                                {change.label}
                              </span>
                            ) : null}
                          </div>
                          {change.before ? (
                            <div className="[overflow-wrap:anywhere] text-fg-2">
                              {change.after ? (
                                <span className="font-medium">
                                  {t("accessA.history.before")}:{" "}
                                </span>
                              ) : null}
                              {change.before}
                            </div>
                          ) : null}
                          {change.after ? (
                            <div className="[overflow-wrap:anywhere]">
                              {change.before ? (
                                <span className="font-medium text-fg-2">
                                  {t("accessA.history.after")}:{" "}
                                </span>
                              ) : null}
                              {change.after}
                            </div>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
                    <p className="min-w-0 flex-1 text-[12px] leading-[18px] text-fg-2">
                      {t("accessA.history.restoreHint")}
                    </p>
                    <Button
                      disabled={!canRestore}
                      onClick={() => setRestore(selected)}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      <RotateCcwIcon aria-hidden="true" />
                      {t("accessA.history.restore")}
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-fg-2">
            <span className="inline-flex items-center gap-1">
              <span aria-hidden="true" className="size-2 rounded-full bg-ok" />
              {t("accessA.history.added")}
            </span>
            <span className="inline-flex items-center gap-1">
              <span aria-hidden="true" className="size-2 rounded-full bg-err" />
              {t("accessA.history.removed")}
            </span>
            <span className="inline-flex items-center gap-1">
              <span
                aria-hidden="true"
                className="size-2 rounded-full bg-warn"
              />
              {t("accessA.history.changed")}
            </span>
            <span className="ml-auto">
              {mode === "open"
                ? t("accessA.history.modeOpen")
                : t("accessA.history.modeRules")}
            </span>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={(next) => (next ? null : setRestore(null))}
        open={restore !== null}
      >
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{t("accessA.history.restoreTitle")}</DialogTitle>
            <DialogDescription>
              {restore
                ? t("accessA.history.restoreBody", { version: restore.version })
                : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              autoFocus
              onClick={() => setRestore(null)}
              type="button"
              variant="outline"
            >
              {t("common.cancel")}
            </Button>
            <Button
              disabled={save.isPending || !canRestore}
              onClick={() => {
                if (!restore) return
                setError(undefined)
                save.mutate(
                  {
                    networkId,
                    data: {
                      document: restore.document,
                      mode: restore.summary.mode,
                    },
                  },
                  {
                    onSuccess: async () => {
                      toast.success(
                        t("accessA.history.restored", {
                          version: restore.version,
                        })
                      )
                      setRestore(null)
                      onOpenChange(false)
                      await refresh()
                    },
                    onError: (cause) =>
                      setError(
                        cause instanceof Error
                          ? cause.message
                          : t("common.error")
                      ),
                  }
                )
              }}
              type="button"
            >
              {t("accessA.history.restore")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/* ------------------------------------------------------------------- toolbar */

export function AccessTools({
  subjects,
  rules,
  versions,
  users,
  mode,
  networkId,
  canAdmin,
  canTest,
  jsonMode,
  onHighlightRule,
  onToggleJson,
  refresh,
}: {
  subjects: AccessSubjects
  rules: AccessRule[]
  versions: ListNetworkPolicyVersions200Item[]
  users: ListUsers200Item[]
  mode: AccessMode
  networkId: string
  canAdmin: boolean
  canTest: boolean
  jsonMode: boolean
  onHighlightRule: (index: number | null) => void
  onToggleJson: () => void
  refresh: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [testOpen, setTestOpen] = useState(false)
  const [compiledOpen, setCompiledOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)

  return (
    <>
      <div
        className="flex min-w-0 flex-wrap items-center gap-1.5"
        data-testid="access-tools"
      >
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                aria-label={t("accessA.tools.label")}
                size="sm"
                type="button"
                variant="outline"
              />
            }
          >
            <WrenchIcon aria-hidden="true" />
            <span className="max-sm:sr-only">{t("accessA.tools.label")}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem
              className="max-sm:min-h-11"
              onClick={() => setTestOpen(true)}
            >
              <CheckCircle2Icon aria-hidden="true" />
              {t("accessA.accordion.test")}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="max-sm:min-h-11"
              onClick={() => setHistoryOpen(true)}
            >
              <HistoryIcon aria-hidden="true" />
              {t("accessA.accordion.history")}
              {versions.length > 0 ? (
                <span
                  aria-hidden="true"
                  className="ml-auto font-mono text-[12px] text-fg-2"
                >
                  #{versions[0]!.version}
                </span>
              ) : null}
            </DropdownMenuItem>
            <div className="mt-1 border-t border-line px-3 pt-2 pb-1 text-[11px] font-semibold tracking-[0.05em] text-fg-2 uppercase">
              {t("accessA.tools.advanced")}
            </div>
            <DropdownMenuItem
              className="max-sm:min-h-11"
              onClick={() => setCompiledOpen(true)}
            >
              <SquareTerminalIcon aria-hidden="true" />
              {t("accessA.tools.technical")}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="max-sm:min-h-11"
              disabled={!jsonMode && !canAdmin}
              onClick={onToggleJson}
            >
              <BracesIcon aria-hidden="true" />
              {jsonMode
                ? t("accessA.json.backToRules")
                : t("accessA.tools.json")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog onOpenChange={setTestOpen} open={testOpen}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>{t("accessA.accordion.test")}</DialogTitle>
            <DialogDescription>{t("accessA.test.hint")}</DialogDescription>
          </DialogHeader>
          <TestAccessForm
            canTest={canTest}
            networkId={networkId}
            onResult={(index) => {
              onHighlightRule(index)
              setTestOpen(false)
            }}
            rules={rules}
            subjects={subjects}
          />
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={setCompiledOpen} open={compiledOpen}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>{t("accessA.tools.technical")}</DialogTitle>
            <DialogDescription>
              {t("accessA.compiledDialog.hint")}
            </DialogDescription>
          </DialogHeader>
          <CompiledAclBody networkId={networkId} subjects={subjects} />
        </DialogContent>
      </Dialog>

      <HistoryDialog
        canRestore={canAdmin}
        mode={mode}
        networkId={networkId}
        onOpenChange={setHistoryOpen}
        open={historyOpen}
        refresh={refresh}
        subjects={subjects}
        users={users}
        versions={versions}
      />
    </>
  )
}
