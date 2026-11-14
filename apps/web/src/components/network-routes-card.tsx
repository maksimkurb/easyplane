import { useTranslation } from "react-i18next"
import { Link } from "wouter"
import { useQueryClient } from "@tanstack/react-query"
import { RouteIcon } from "lucide-react"
import { toast } from "sonner"

import {
  getListDevicesQueryKey,
  getListNetworkRoutesQueryKey,
  useDecideDeviceRoute,
  useListNetworkRoutes,
} from "@/api/generated/easyplane"
import { useAuth } from "@/auth/auth-context"
import { SectionCard } from "@/components/shared/section-card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

function stateVariant(state: "pending" | "approved" | "rejected") {
  if (state === "approved") return "success" as const
  if (state === "rejected") return "destructive" as const
  return "warning" as const
}

/**
 * Subnet/exit-node approvals plus what the clients actually advertise.
 * Only approved rows are compiled into the pushed config.
 */
export function NetworkRoutesCard({ networkId }: { networkId: string }) {
  const { t } = useTranslation()
  const { isAdmin, canManage } = useAuth()
  const queryClient = useQueryClient()
  const routesQuery = useListNetworkRoutes(networkId)
  const decide = useDecideDeviceRoute({
    mutation: {
      onSuccess: async () => {
        toast.success(t("routes.decided"))
        await queryClient.invalidateQueries({ queryKey: getListNetworkRoutesQueryKey(networkId) })
        await queryClient.invalidateQueries({ queryKey: getListDevicesQueryKey() })
      },
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : t("common.error")),
    },
  })

  const data = routesQuery.data?.data
  if (!data) return null

  const reports = data.reports.filter(
    (entry) =>
      entry.report !== null &&
      (entry.report.configuredCidrs.length > 0 ||
        entry.report.observedCidrs.length > 0 ||
        entry.report.unknownPeers.length > 0 ||
        entry.report.unapprovedCidrs.length > 0 ||
        entry.report.unapprovedObservedCidrs.length > 0),
  )
  const flagged = data.reports.filter(
    (entry) =>
      entry.report !== null &&
      (entry.report.unapprovedCidrs.length > 0 ||
        entry.report.unapprovedObservedCidrs.length > 0 ||
        entry.report.unknownPeers.length > 0),
  )

  return (
    <SectionCard
      action={<RouteIcon className="size-4 text-muted-foreground" />}
      description={t("routes.description")}
      title={t("routes.title")}
    >
      {data.routes.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("routes.empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("devices.hostname")}</TableHead>
                <TableHead>{t("routes.kind")}</TableHead>
                <TableHead>{t("routes.cidr")}</TableHead>
                <TableHead>{t("common.status")}</TableHead>
                <TableHead className="text-right">{t("common.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.routes.map((route) => (
                <TableRow key={route.id}>
                  <TableCell className="text-sm">
                    <Link className="hover:underline" href={`/devices/${route.deviceId}`}>
                      {route.deviceHostname}
                    </Link>
                  </TableCell>
                  <TableCell className="text-xs">
                    {route.kind === "subnet" ? t("routes.subnet") : t("routes.exitNode")}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {route.cidr || (route.kind === "exit_node" ? "0.0.0.0/0" : "")}
                  </TableCell>
                  <TableCell>
                    <Badge variant={stateVariant(route.state)}>
                      {t(`routes.state.${route.state}`)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {isAdmin && route.state === "pending" ? (
                      <span className="flex justify-end gap-1">
                        <Button
                          disabled={decide.isPending}
                          onClick={() =>
                            decide.mutate({ routeId: route.id, data: { state: "approved" } })
                          }
                          size="sm"
                          variant="outline"
                        >
                          {t("common.approve")}
                        </Button>
                        <Button
                          disabled={decide.isPending}
                          onClick={() =>
                            decide.mutate({ routeId: route.id, data: { state: "rejected" } })
                          }
                          size="sm"
                          variant="ghost"
                        >
                          {t("routes.reject")}
                        </Button>
                      </span>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        {canManage ? t("routes.requestHint") : t("routes.viewerHint")}
      </p>

      {flagged.length > 0 ? (
        <Alert className="mt-3 border-destructive/40">
          <AlertDescription>
            <p className="mb-1 font-medium">{t("routes.unapprovedTitle")}</p>
            <ul className="list-disc space-y-1 pl-4 text-xs">
              {flagged.map((entry) => (
                <li key={entry.deviceId}>
                  <Link className="font-mono hover:underline" href={`/devices/${entry.deviceId}`}>
                    {entry.deviceHostname}
                  </Link>
                  {": "}
                  {[
                    ...(entry.report?.unapprovedCidrs ?? []),
                    ...(entry.report?.unapprovedObservedCidrs ?? []),
                    ...(entry.report?.unknownPeers ?? []).flatMap((peer) =>
                      peer.proxyCidrs.map((cidr) => `${cidr} (${peer.ipv4})`),
                    ),
                  ].join(", ")}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs">{t("routes.unapprovedHonestNote")}</p>
          </AlertDescription>
        </Alert>
      ) : null}

      {reports.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("devices.hostname")}</TableHead>
                <TableHead>{t("routes.approved")}</TableHead>
                <TableHead>{t("routes.configured")}</TableHead>
                <TableHead>{t("routes.observed")}</TableHead>
                <TableHead>{t("routes.exitNodeSeen")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reports.map((entry) => (
                <TableRow key={entry.deviceId}>
                  <TableCell className="text-sm">{entry.deviceHostname}</TableCell>
                  <TableCell className="font-mono text-[11px]">
                    {entry.report?.approvedCidrs.join(", ") || t("common.none")}
                  </TableCell>
                  <TableCell className="font-mono text-[11px]">
                    {entry.report?.configuredCidrs.join(", ") || t("common.none")}
                  </TableCell>
                  <TableCell className="font-mono text-[11px]">
                    {entry.report?.observedCidrs.join(", ") || t("common.none")}
                  </TableCell>
                  <TableCell className="text-xs">
                    {entry.report?.reportedExitNode ? t("common.yes") : t("common.no")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </SectionCard>
  )
}
