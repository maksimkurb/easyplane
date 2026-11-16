import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "wouter"
import { CheckCircle2Icon, PencilIcon, ShieldIcon, XCircleIcon } from "lucide-react"
import { toast } from "sonner"

import {
  useGetNetworkPolicy,
  useListDevices,
  useListNetworkPolicyVersions,
  useListNetworkRoutes,
  useListTags,
  useTestNetworkReachability,
} from "@/api/generated/easyplane"
import type { TestNetworkReachabilityBodyProtocol } from "@/api/generated/model"
import type { NetworkShellData } from "@/components/network/network-shell"
import { NetworkShell } from "@/components/network/network-shell"
import { OptionSelect } from "@/components/shared/option-select"
import { Button } from "@/components/ui/button"
import { Chip } from "@/components/ui/chip"
import { Segmented } from "@/components/ui/segmented"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatDateTime } from "@/lib/format"
import { toStatementRows } from "@/lib/policy-document"

export function NetworkAccessPage({ networkId }: { networkId: string }) {
  return (
    <NetworkShell networkId={networkId} tab="access">
      {(data) => <AccessTab data={data} />}
    </NetworkShell>
  )
}

function AccessTab({ data }: { data: NetworkShellData }) {
  const { t, i18n } = useTranslation()
  const networkId = data.network.id
  const policyQuery = useGetNetworkPolicy(networkId)
  const versionsQuery = useListNetworkPolicyVersions(networkId)
  const tagsQuery = useListTags()
  const devicesQuery = useListDevices({ networkId })
  const routesQuery = useListNetworkRoutes(networkId)

  const policy = policyQuery.data?.data?.policy ?? null
  const version = policyQuery.data?.data?.version ?? 0
  const rows = useMemo(
    () => toStatementRows((policy?.document ?? {}) as Parameters<typeof toStatementRows>[0]),
    [policy]
  )
  const tags = tagsQuery.data?.data ?? []
  const approvedDevices = (devicesQuery.data?.data ?? []).filter(
    (device) => device.state === "approved"
  )
  const approvedCidrs = [
    ...new Set(
      (routesQuery.data?.data?.routes ?? [])
        .filter((route) => route.state === "approved" && route.kind === "subnet")
        .map((route) => route.cidr)
    ),
  ]
  const latestVersion = versionsQuery.data?.data?.[0]
  const approvedDevicesAll = (devicesQuery.data?.data ?? []).filter(
    (device) => device.state === "approved"
  )
  const inSync = approvedDevicesAll.filter((device) => device.sync === "in-sync").length

  return (
    <div className="flex flex-col gap-5">
      <section className="overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-line">
        <div className="flex flex-wrap items-center gap-3 px-4 py-4 sm:px-5">
          <div className="min-w-0 flex-1">
            <h2 className="text-base leading-6 font-semibold tracking-[-0.006em]">
              {t("accessPage.rulesTitle")}
            </h2>
            <p className="text-[13px] text-fg-3">{t("accessPage.rulesHint")}</p>
          </div>
          <div className="flex w-full gap-2 sm:w-auto sm:flex-none">
            <Button
              className="flex-1 justify-center sm:flex-none"
              render={<Link href={`/networks/${networkId}/policy?mode=json`} />}
              size="sm"
              variant="ghost"
            >
              {t("accessPage.editJson")}
            </Button>
            <Button
              className="flex-1 justify-center sm:flex-none"
              render={<Link href={`/networks/${networkId}/policy?add=rule`} />}
              size="sm"
              variant="outline"
            >
              {t("accessPage.addRule")}
            </Button>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="border-t border-line px-4 py-8 text-center sm:px-5">
            <ShieldIcon aria-hidden="true" className="mx-auto size-6 text-fg-3" />
            <p className="mt-2 text-sm font-medium">{t("accessPage.noRules")}</p>
            <p className="mt-1 text-[13px] text-fg-3">{t("accessPage.noRulesHint")}</p>
            <Button
              className="mt-3"
              render={<Link href={`/networks/${networkId}/policy`} />}
              size="sm"
              variant="outline"
            >
              {t("accessPage.openEditor")}
            </Button>
          </div>
        ) : (
          <>
          <ul className="divide-y divide-line border-t border-line md:hidden">
            {rows.map((row, index) => (
              <li className="flex items-start gap-3 px-4 py-3" key={`m-${index}`}>
                <Chip variant={row.action === "accept" ? "ok" : "err"}>
                  {row.action === "accept" ? t("policy.allow") : t("policy.deny")}
                </Chip>
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-xs break-words">
                    {row.src || "—"}
                    <span className="px-1 text-fg-3">→</span>
                    {row.dst || "—"}
                  </p>
                  <p className="mt-0.5 text-xs text-fg-3">
                    {row.proto === "any"
                      ? t("accessPage.anyProtocol")
                      : row.proto.toUpperCase()}
                  </p>
                </div>
                <Button
                  aria-label={t("accessPage.edit")}
                  render={<Link href={`/networks/${networkId}/policy`} />}
                  size="icon-sm"
                  variant="ghost"
                >
                  <PencilIcon className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto border-t border-line md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20 pl-4 sm:pl-5">{t("policy.action")}</TableHead>
                  <TableHead>{t("policy.source")}</TableHead>
                  <TableHead>{t("policy.destination")}</TableHead>
                  <TableHead>{t("policy.proto")}</TableHead>
                  <TableHead className="pr-4 text-right sm:pr-5">
                    {t("common.actions")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, index) => (
                  <TableRow key={index}>
                    <TableCell className="pl-4 sm:pl-5">
                      <Chip variant={row.action === "accept" ? "ok" : "err"}>
                        {row.action === "accept" ? t("policy.allow") : t("policy.deny")}
                      </Chip>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{row.src || "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{row.dst || "—"}</TableCell>
                    <TableCell className="font-mono text-xs text-fg-2">
                      {row.proto === "any"
                        ? t("accessPage.anyProtocol")
                        : row.proto.toUpperCase()}
                    </TableCell>
                    <TableCell className="pr-4 text-right sm:pr-5">
                      <Button
                        aria-label={t("accessPage.edit")}
                        render={<Link href={`/networks/${networkId}/policy`} />}
                        size="icon-sm"
                        variant="ghost"
                      >
                        <PencilIcon className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          </>
        )}
      </section>

      <TestAccessCard
        approvedCidrs={approvedCidrs}
        approvedDevices={approvedDevices}
        networkId={networkId}
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-xl bg-card shadow-sm ring-1 ring-line">
          <div className="flex items-center gap-3 px-4 py-4 sm:px-5">
            <div className="min-w-0 flex-1">
              <h2 className="text-base leading-6 font-semibold tracking-[-0.006em]">
                {t("policy.tags")}
              </h2>
              <p className="text-[13px] text-fg-3">{t("accessPage.tagsHint")}</p>
            </div>
            <Button
              render={<Link href={`/networks/${networkId}/policy`} />}
              size="sm"
              variant="ghost"
            >
              {t("accessPage.manage")}
            </Button>
          </div>
          <div className="flex flex-wrap gap-2 px-4 pb-4 sm:px-5">
            {tags.length === 0 ? (
              <p className="text-[13px] text-fg-3">{t("common.empty")}</p>
            ) : (
              tags.map((tag) => (
                <Chip key={tag.id} variant="tag">
                  {tag.name}
                  <span className="ml-1 text-fg-3">{tag.deviceCount}</span>
                </Chip>
              ))
            )}
          </div>
        </section>

        <section className="rounded-xl bg-card shadow-sm ring-1 ring-line">
          <div className="flex items-center gap-3 px-4 py-4 sm:px-5">
            <div className="min-w-0 flex-1">
              <h2 className="text-base leading-6 font-semibold tracking-[-0.006em]">
                {version > 0
                  ? t("policy.activeVersion", { version })
                  : t("policy.noPolicy")}
              </h2>
              <p className="text-[13px] text-fg-3">
                {latestVersion?.note ||
                  (latestVersion
                    ? formatDateTime(latestVersion.createdAt, i18n.language)
                    : t("accessPage.noVersionHint"))}
              </p>
            </div>
            <Button
              render={<Link href={`/networks/${networkId}/policy`} />}
              size="sm"
              variant="ghost"
            >
              {t("accessPage.history")}
            </Button>
          </div>
          <div className="px-4 pb-4 sm:px-5">
            <p className="flex items-center gap-2.5 text-[13px] text-fg-2">
              <span
                aria-hidden="true"
                className={version > 0 ? "size-2 rounded-full bg-ok-dot" : "size-2 rounded-full bg-fg-3/50"}
              />
              {version > 0
                ? t("accessPage.appliedCount", {
                    applied: inSync,
                    total: approvedDevicesAll.length,
                  })
                : t("accessPage.notApplied")}
            </p>
          </div>
        </section>
      </div>
    </div>
  )
}

function TestAccessCard({
  networkId,
  approvedDevices,
  approvedCidrs,
}: {
  networkId: string
  approvedDevices: { id: string; hostname: string; dnsName: string | null }[]
  approvedCidrs: string[]
}) {
  const { t } = useTranslation()
  const [src, setSrc] = useState("")
  const [dst, setDst] = useState("")
  const [protocol, setProtocol] = useState<TestNetworkReachabilityBodyProtocol>("tcp")
  const [port, setPort] = useState("22")
  const [result, setResult] = useState<{
    allowed: boolean
    ingressAction: string
    ingressRule: string | null
    egressAction: string
    egressRule: string | null
    explanation: string[]
  } | null>(null)

  const test = useTestNetworkReachability({
    mutation: {
      onSuccess: (response) => {
        const reachability = response.data.reachability
        setResult({
          allowed: reachability.allowed,
          ingressAction: reachability.ingress.action,
          ingressRule: reachability.ingress.matchedRule,
          egressAction: reachability.egress.action,
          egressRule: reachability.egress.matchedRule,
          explanation: reachability.explanation,
        })
      },
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : t("common.error")),
    },
  })

  const isCidr = approvedCidrs.includes(dst)
  const deviceOptions = approvedDevices.map((device) => ({
    value: device.id,
    label: device.dnsName || device.hostname,
  }))

  return (
    <section className="rounded-xl bg-card shadow-sm ring-1 ring-line">
      <div className="px-4 py-4 sm:px-5">
        <h2 className="text-base leading-6 font-semibold tracking-[-0.006em]">
          {t("accessPage.testTitle")}
        </h2>
        <p className="text-[13px] text-fg-3">{t("accessPage.testHint")}</p>
      </div>
      <div className="flex flex-col gap-4 px-4 pb-4 sm:px-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="text-[13px] font-medium">{t("policy.source")}</span>
            <OptionSelect
              empty={
                approvedDevices.length === 0 ? t("policy.noSourceDevices") : undefined
              }
              onValueChange={setSrc}
              options={deviceOptions}
              placeholder={t("policy.chooseSource")}
              triggerClassName="max-w-none"
              value={src}
            />
          </label>
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="text-[13px] font-medium">{t("policy.destination")}</span>
            <OptionSelect
              empty={
                deviceOptions.length + approvedCidrs.length === 0
                  ? t("policy.noDestinationOptions")
                  : undefined
              }
              onValueChange={setDst}
              options={[
                ...deviceOptions,
                ...approvedCidrs.map((cidr) => ({
                  value: cidr,
                  label: t("policy.subnetRoute", { cidr }),
                })),
              ]}
              placeholder={t("policy.chooseDestination")}
              triggerClassName="max-w-none"
              value={dst}
            />
          </label>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium">{t("policy.proto")}</span>
            <Segmented
              label={t("policy.proto")}
              onValueChange={setProtocol}
              options={[
                { value: "tcp", label: "TCP" },
                { value: "udp", label: "UDP" },
                { value: "icmp", label: "ICMP" },
              ]}
              value={protocol}
            />
          </div>
          {protocol === "icmp" ? (
            <p className="flex h-10 items-center text-xs text-fg-3">
              {t("accessPage.icmpHint")}
            </p>
          ) : (
            <label className="flex w-24 flex-col gap-1.5">
              <span className="text-[13px] font-medium">{t("policy.port")}</span>
              <input
                aria-label={t("policy.port")}
                className="h-10 w-full rounded-lg border border-line-2 bg-card px-3 font-mono text-sm outline-none focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand-soft"
                inputMode="numeric"
                max={65535}
                min={0}
                onChange={(event) => setPort(event.target.value)}
                type="number"
                value={port}
              />
            </label>
          )}
          <span className="hidden flex-1 sm:block" />
          <Button
            className="max-sm:w-full"
            disabled={test.isPending || !src || !dst}
            onClick={() =>
              test.mutate({
                networkId,
                data: {
                  srcDeviceId: src,
                  ...(isCidr ? { dstCidr: dst } : { dstDeviceId: dst }),
                  ...(protocol === "icmp"
                    ? { protocol }
                    : { protocol, port: Number(port) }),
                },
              })
            }
            variant="outline"
          >
            {test.isPending ? t("common.loading") : t("accessPage.runTest")}
          </Button>
        </div>

        {result ? (
          <div
            className={`flex items-start gap-3 rounded-xl px-4 py-3 text-[13px] ring-1 ${
              result.allowed
                ? "bg-ok-soft ring-ok/30"
                : "bg-err-soft ring-err-line"
            }`}
            role="status"
          >
            {result.allowed ? (
              <CheckCircle2Icon aria-hidden="true" className="mt-0.5 size-4 flex-none text-ok" />
            ) : (
              <XCircleIcon aria-hidden="true" className="mt-0.5 size-4 flex-none text-err" />
            )}
            <div className="min-w-0">
              <p className="font-medium">
                {result.allowed ? t("policy.allowed") : t("policy.denied")}
              </p>
              <p className="mt-0.5 text-fg-2">
                {t("accessPage.decision", {
                  ingress: describeRule(result.ingressAction, result.ingressRule),
                  egress: describeRule(result.egressAction, result.egressRule),
                })}
              </p>
              {result.explanation.length > 0 ? (
                <ul className="mt-1 list-disc pl-4 font-mono text-[11px] text-fg-3">
                  {result.explanation.map((line, index) => (
                    <li key={index}>{line}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}

function describeRule(action: string, rule: string | null): string {
  return rule ? `${action} (${rule})` : action
}
