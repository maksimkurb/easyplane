import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "wouter"
import { useQueryClient } from "@tanstack/react-query"
import { GlobeIcon, PencilIcon } from "lucide-react"
import { toast } from "sonner"

import {
  getListMagicDnsNamesQueryKey,
  useGetNetwork,
  useListMagicDnsNames,
  useRenameDevice,
} from "@/api/generated/easyplane"
import { useAuth } from "@/auth/auth-context"
import { SectionCard } from "@/components/shared/section-card"
import { Chip } from "@/components/ui/chip"
import { Button } from "@/components/ui/button"
import { normalizeDnsName } from "@/lib/device-presentation"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

/**
 * The list of MagicDNS names. The enable switch and the zone live in the DNS
 * settings section so they follow the page's one save model; this component
 * only shows and renames names.
 */
export function NetworkMagicDnsCard({
  networkId,
  embedded = false,
}: {
  networkId: string
  embedded?: boolean
}) {
  const { t } = useTranslation()
  const { canManage } = useAuth()
  const queryClient = useQueryClient()
  const networkQuery = useGetNetwork(networkId)
  const namesQuery = useListMagicDnsNames(networkId)
  const [editing, setEditing] = useState<{
    deviceId: string
    name: string
  } | null>(null)

  const zone = networkQuery.data?.data?.magicDnsZone ?? ""
  const dns = namesQuery.data?.data

  const rename = useRenameDevice({
    mutation: {
      onSuccess: async () => {
        setEditing(null)
        toast.success(t("magicDns.renamed"))
        await queryClient.invalidateQueries({
          queryKey: getListMagicDnsNamesQueryKey(networkId),
        })
      },
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : t("common.error")),
    },
  })

  if (!dns || !zone) return null

  const body = (
    <>
      {dns.names.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("magicDns.empty")}</p>
      ) : (
        <>
          <ul className="divide-y divide-line overflow-hidden rounded-lg ring-1 ring-line sm:hidden">
            {dns.names.map((name) => (
              <li
                className="flex items-start gap-2 px-3 py-2.5"
                key={name.deviceId}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p
                      className="truncate font-mono text-xs"
                      title={normalizeDnsName(name.fqdn)}
                    >
                      {normalizeDnsName(name.fqdn)}
                    </p>
                    {name.renamed ? (
                      <Chip className="text-xs">
                        {t("magicDns.customName")}
                      </Chip>
                    ) : null}
                  </div>
                  <p className="font-mono text-xs text-fg-2">{name.ipv4}</p>
                </div>
                {canManage ? (
                  <Button
                    aria-label={t("magicDns.rename")}
                    onClick={() =>
                      setEditing({
                        deviceId: name.deviceId,
                        name: name.hostname,
                      })
                    }
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
                  <TableHead className="w-12 text-right">
                    <span className="sr-only">{t("common.actions")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dns.names.map((name) => (
                  <TableRow key={name.deviceId}>
                    <TableCell className="text-xs">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Link
                          className="font-mono hover:underline"
                          href={`/devices/${name.deviceId}`}
                          title={
                            name.reportedHostname ??
                            normalizeDnsName(name.fqdn)
                          }
                        >
                          {normalizeDnsName(name.fqdn)}
                        </Link>
                        {name.renamed ? (
                          <Chip className="text-xs">
                            {t("magicDns.customName")}
                          </Chip>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {name.ipv4}
                    </TableCell>
                    <TableCell className="text-right">
                      {canManage ? (
                        <Button
                          aria-label={t("magicDns.renameFor", {
                            name: name.hostname,
                          })}
                          onClick={() =>
                            setEditing({
                              deviceId: name.deviceId,
                              name: name.hostname,
                            })
                          }
                          size="icon-sm"
                          variant="ghost"
                        >
                          <PencilIcon className="size-4" />
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

      <p className="mt-3 text-xs text-muted-foreground">
        {t("magicDns.honestNote")}
      </p>

      <Dialog
        onOpenChange={(open) => (open ? undefined : setEditing(null))}
        open={editing !== null}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("magicDns.renameTitle")}</DialogTitle>
            <DialogDescription>
              {t("magicDns.renameDescription")}
            </DialogDescription>
          </DialogHeader>
          {editing ? (
            <div className="grid gap-2 py-2">
              <span className="text-xs text-muted-foreground">
                {t("magicDns.label")}
              </span>
              <Input
                className="font-mono text-xs"
                onChange={(event) =>
                  setEditing({ ...editing, name: event.target.value })
                }
                value={editing.name}
              />
              <span className="text-xs text-muted-foreground">
                {editing.name}.{zone}
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
                rename.mutate({
                  deviceId: editing.deviceId,
                  data: { dnsName: editing.name },
                })
              }
            >
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )

  if (embedded) {
    return <div className="flex min-w-0 flex-col gap-3">{body}</div>
  }

  return (
    <SectionCard
      action={<GlobeIcon className="size-4 text-muted-foreground" />}
      description={t("magicDns.description")}
      title={t("magicDns.title")}
    >
      {body}
    </SectionCard>
  )
}
