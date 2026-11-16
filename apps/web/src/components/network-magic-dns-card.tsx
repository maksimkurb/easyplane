import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "wouter"
import { useQueryClient } from "@tanstack/react-query"
import { GlobeIcon, PencilIcon } from "lucide-react"
import { toast } from "sonner"

import {
  getGetNetworkQueryKey,
  getListMagicDnsNamesQueryKey,
  useGetNetwork,
  useListMagicDnsNames,
  useRenameDevice,
  useUpdateNetwork,
} from "@/api/generated/easyplane"
import { useAuth } from "@/auth/auth-context"
import { SectionCard } from "@/components/shared/section-card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

/**
 * Per-network MagicDNS: the switch is pushed as `enable_magic_dns`; the zone is
 * used for names in the panel. EasyTier keeps `tld_dns_zone` in local client
 * flags (there is no NetworkConfig field), so a custom zone only resolves when
 * the client runs its own instance with `--tld-dns-zone`.
 */
export function NetworkMagicDnsCard({ networkId }: { networkId: string }) {
  const { t } = useTranslation()
  const { canManage } = useAuth()
  const queryClient = useQueryClient()
  const networkQuery = useGetNetwork(networkId)
  const namesQuery = useListMagicDnsNames(networkId)
  const [zone, setZone] = useState("")
  const [editing, setEditing] = useState<{ deviceId: string; name: string } | null>(null)

  const network = networkQuery.data?.data
  const dns = namesQuery.data?.data

  const update = useUpdateNetwork({
    mutation: {
      onSuccess: async () => {
        toast.success(t("magicDns.updated"))
        await queryClient.invalidateQueries({ queryKey: getGetNetworkQueryKey(networkId) })
        await queryClient.invalidateQueries({ queryKey: getListMagicDnsNamesQueryKey(networkId) })
      },
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : t("common.error")),
    },
  })

  const rename = useRenameDevice({
    mutation: {
      onSuccess: async () => {
        setEditing(null)
        toast.success(t("magicDns.renamed"))
        await queryClient.invalidateQueries({ queryKey: getListMagicDnsNamesQueryKey(networkId) })
      },
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : t("common.error")),
    },
  })

  if (!network || !dns) return null

  return (
    <SectionCard
      action={<GlobeIcon className="size-4 text-muted-foreground" />}
      description={t("magicDns.description")}
      title={t("magicDns.title")}
    >
      <div className="mb-4 flex flex-wrap items-end gap-4">
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={network.magicDnsEnabled}
            disabled={!canManage}
            onCheckedChange={(checked) =>
              update.mutate({ networkId, data: { magicDnsEnabled: checked } })
            }
          />
          {t("magicDns.enabled")}
        </label>
        <div className="flex items-end gap-2">
          <div className="grid gap-1">
            <span className="text-xs text-muted-foreground">{t("magicDns.zone")}</span>
            <Input
              aria-label={t("magicDns.zone")}
              className="h-8 w-56 font-mono text-xs"
              disabled={!canManage}
              onChange={(event) => setZone(event.target.value)}
              placeholder={network.magicDnsZone}
              value={zone}
            />
          </div>
          {canManage ? (
            <Button
              disabled={zone.trim() === "" || update.isPending}
              onClick={() => update.mutate({ networkId, data: { magicDnsZone: zone.trim() } })}
              size="sm"
              variant="outline"
            >
              {t("common.save")}
            </Button>
          ) : null}
        </div>
        <Badge variant={network.magicDnsEnabled ? "success" : "outline"}>
          {network.magicDnsEnabled ? t("magicDns.on") : t("magicDns.off")}
        </Badge>
      </div>

      {network.magicDnsZone !== dns.defaultZone ? (
        <Alert className="mb-4">
          <AlertDescription>
            {t("magicDns.zoneWarning", {
              zone: network.magicDnsZone,
              flag: `--tld-dns-zone ${network.magicDnsZone}`,
              defaultZone: dns.defaultZone,
            })}
          </AlertDescription>
        </Alert>
      ) : null}

      {dns.names.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("magicDns.empty")}</p>
      ) : (
        <>
        <ul className="divide-y divide-line overflow-hidden rounded-lg ring-1 ring-line sm:hidden">
          {dns.names.map((name) => (
            <li className="flex flex-wrap items-center gap-2 px-3 py-2.5" key={name.deviceId}>
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-xs">{name.fqdn}</p>
                <p className="font-mono text-[11px] text-fg-3">{name.ipv4}</p>
              </div>
              {canManage ? (
                <Button
                  aria-label={t("magicDns.rename")}
                  onClick={() => setEditing({ deviceId: name.deviceId, name: name.hostname })}
                  size="icon-sm"
                  variant="ghost"
                >
                  <PencilIcon className="size-4" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        <div className="hidden overflow-x-auto sm:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("magicDns.name")}</TableHead>
                <TableHead>{t("devices.virtualIp")}</TableHead>
                <TableHead>{t("devices.hostname")}</TableHead>
                <TableHead className="text-right">{t("common.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dns.names.map((name) => (
                <TableRow key={name.deviceId}>
                  <TableCell className="font-mono text-xs">{name.fqdn}</TableCell>
                  <TableCell className="font-mono text-xs">{name.ipv4}</TableCell>
                  <TableCell className="text-xs">
                    <Link className="hover:underline" href={`/devices/${name.deviceId}`}>
                      {name.reportedHostname || t("common.none")}
                    </Link>
                    {name.renamed ? (
                      <Badge className="ml-2" variant="warning">
                        {t("magicDns.renamedBadge")}
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right">
                    {canManage ? (
                      <Button
                        onClick={() => setEditing({ deviceId: name.deviceId, name: name.hostname })}
                        size="sm"
                        variant="ghost"
                      >
                        <PencilIcon className="size-4" />
                        {t("magicDns.rename")}
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        </>
      )}

      <p className="mt-3 text-xs text-muted-foreground">{t("magicDns.honestNote")}</p>

      <Dialog onOpenChange={(open) => (open ? undefined : setEditing(null))} open={editing !== null}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("magicDns.renameTitle")}</DialogTitle>
            <DialogDescription>{t("magicDns.renameDescription")}</DialogDescription>
          </DialogHeader>
          {editing ? (
            <div className="grid gap-2 py-2">
              <span className="text-xs text-muted-foreground">{t("magicDns.label")}</span>
              <Input
                className="font-mono text-xs"
                onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                value={editing.name}
              />
              <span className="text-xs text-muted-foreground">
                {editing.name}.{network.magicDnsZone}
              </span>
            </div>
          ) : null}
          <DialogFooter>
            <Button onClick={() => setEditing(null)} variant="outline">
              {t("common.cancel")}
            </Button>
            <Button
              disabled={rename.isPending || !editing}
              onClick={() =>
                editing &&
                rename.mutate({ deviceId: editing.deviceId, data: { dnsName: editing.name } })
              }
            >
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionCard>
  )
}
