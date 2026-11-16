import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "wouter"
import { ChevronRightIcon, FileUpIcon, NetworkIcon, PlusIcon } from "lucide-react"
import { toast } from "sonner"

import { useCreateNetwork, useListDevices, useListNetworks } from "@/api/generated/easyplane"
import { useAuth } from "@/auth/auth-context"
import { PageContainer } from "@/components/layout/page-container"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/shared/field"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { LinkButton } from "@/components/shared/link-button"
import { Chip, Dot } from "@/components/ui/chip"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"

export function NetworksPage() {
  const { t } = useTranslation()
  const { isAdmin } = useAuth()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [cidr, setCidr] = useState("10.144.144.0/24")

  const networksQuery = useListNetworks()
  const devicesQuery = useListDevices()
  const createNetwork = useCreateNetwork({
    mutation: {
      onSuccess: async () => {
        toast.success(t("networks.created"))
        setOpen(false)
        setName("")
      },
      onError: (error) => {
        toast.error(error instanceof Error ? error.message : t("common.error"))
      },
    },
  })

  const networks = networksQuery.data?.data ?? []
  const devices = useMemo(() => devicesQuery.data?.data ?? [], [devicesQuery.data])
  const onlineByNetwork = useMemo(() => {
    const counts = new Map<string, number>()
    for (const device of devices) {
      if (device.online !== "online") continue
      counts.set(device.networkId, (counts.get(device.networkId) ?? 0) + 1)
    }
    return counts
  }, [devices])

  return (
    <PageContainer className="py-8 sm:py-10">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1
            className="text-2xl leading-8 font-semibold tracking-[-0.018em]"
            id="page-title"
          >
            {t("networks.title")}
          </h1>
          <p className="mt-0.5 text-sm text-fg-3">
            {t("networks.summary", {
              networks: networks.length,
              devices: devices.length,
            })}
          </p>
        </div>
        {isAdmin ? (
          <div className="flex w-full gap-2 sm:w-auto sm:flex-none">
            <LinkButton
              aria-label={t("networks.import.open")}
              className="flex-1 justify-center sm:flex-none"
              href="/networks/import"
              variant="outline"
            >
              <FileUpIcon className="size-4" />
              {t("networks.import.short")}
            </LinkButton>
            <Button
              className="flex-1 justify-center sm:flex-none"
              onClick={() => setOpen(true)}
            >
              <PlusIcon className="size-4" />
              {t("networks.create")}
            </Button>
          </div>
        ) : null}
      </header>

      <section aria-label={t("networks.title")} className="mt-6">
        {networksQuery.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
          </div>
        ) : networks.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <NetworkIcon />
              </EmptyMedia>
              <EmptyTitle>{t("networks.title")}</EmptyTitle>
              <EmptyDescription>{t("networks.empty")}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-line">
            <div
              aria-hidden="true"
              className="hidden h-10 grid-cols-[minmax(0,2fr)_minmax(140px,1fr)_minmax(170px,1.2fr)_44px] items-center gap-4 border-b border-line px-5 text-xs font-medium text-fg-3 md:grid"
            >
              <span>{t("networks.table.network")}</span>
              <span>{t("networks.table.range")}</span>
              <span>{t("networks.table.devices")}</span>
              <span />
            </div>
            <ul className="divide-y divide-line">
              {networks.map((network) => {
                const online = onlineByNetwork.get(network.id) ?? 0
                const total = network.deviceCounts.approved
                const waiting = network.deviceCounts.pending
                return (
                  <li key={network.id}>
                    <Link
                      className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto_24px] items-center gap-2 px-4 py-3 transition-colors hover:bg-surface-2/70 md:grid-cols-[minmax(0,2fr)_minmax(140px,1fr)_minmax(170px,1.2fr)_44px] md:gap-4 md:px-5"
                      href={`/networks/${network.id}`}
                    >
                      <div className="flex min-w-0 items-center gap-3.5">
                        <span className="grid size-9 flex-none place-items-center rounded-[9px] bg-surface-2 text-fg-2 ring-1 ring-line">
                          <NetworkIcon className="size-4" />
                        </span>
                        <div className="min-w-0">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="truncate font-semibold">{network.name}</span>
                          </div>
                          <div className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-fg-3">
                            <span className="hidden truncate font-mono md:inline">
                              {network.networkName}
                            </span>
                            <span className="flex items-center gap-1.5 md:hidden">
                              <Dot online={online > 0} />
                              {t("networks.onlineOf", { online, total })}
                            </span>
                          </div>
                        </div>
                      </div>
                      <span className="hidden truncate font-mono text-xs text-fg-2 md:block">
                        {network.ipv4Cidr}
                      </span>
                      <div className="flex items-center justify-end gap-2.5">
                        <span className="hidden items-center gap-2 text-[13px] text-fg-2 md:inline-flex">
                          <Dot online={online > 0} />
                          {t("networks.onlineOf", { online, total })}
                        </span>
                        {waiting > 0 ? (
                          <Chip variant="warn">
                            {t("networks.waitingCount", { count: waiting })}
                          </Chip>
                        ) : null}
                      </div>
                      <span className="flex justify-end text-fg-3">
                        <ChevronRightIcon className="size-4" />
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </section>

      <Dialog onOpenChange={setOpen} open={open}>
        <DialogContent>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              createNetwork.mutate({ data: { name, ipv4Cidr: cidr } })
            }}
          >
            <DialogHeader>
              <DialogTitle>{t("networks.createTitle")}</DialogTitle>
              <DialogDescription>{t("networks.description")}</DialogDescription>
            </DialogHeader>
            <FieldGroup className="gap-4 py-4">
              <Field className="gap-2">
                <FieldLabel htmlFor="network-name">{t("networks.name")}</FieldLabel>
                <Input
                  autoFocus
                  id="network-name"
                  onChange={(event) => setName(event.target.value)}
                  required
                  value={name}
                />
              </Field>
              <Field className="gap-2">
                <FieldLabel htmlFor="network-cidr">{t("networks.cidr")}</FieldLabel>
                <Input
                  className="font-mono"
                  id="network-cidr"
                  onChange={(event) => setCidr(event.target.value)}
                  required
                  value={cidr}
                />
                <FieldDescription>{t("networks.cidrHint")}</FieldDescription>
              </Field>
              <Alert>
                <AlertDescription>{t("access.createDefaultHint")}</AlertDescription>
              </Alert>
            </FieldGroup>
            <DialogFooter>
              <Button onClick={() => setOpen(false)} type="button" variant="outline">
                {t("common.cancel")}
              </Button>
              <Button disabled={createNetwork.isPending || !name} type="submit">
                {createNetwork.isPending ? t("common.loading") : t("common.create")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
