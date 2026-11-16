import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "wouter"
import { FileUpIcon, NetworkIcon, PlusIcon } from "lucide-react"
import { toast } from "sonner"

import { useCreateNetwork, useListNetworks } from "@/api/generated/easyplane"
import { useAuth } from "@/auth/auth-context"
import { PageHeader } from "@/components/shared/page-header"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/shared/field"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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

  return (
    <>
      <PageHeader
        actions={
          isAdmin ? (
            <span className="flex gap-2">
              <Button
                render={<Link href="/networks/import" />}
                variant="outline"
              >
                <FileUpIcon className="size-4" />
                {t("networks.import.open")}
              </Button>
              <Button onClick={() => setOpen(true)}>
                <PlusIcon className="size-4" />
                {t("networks.create")}
              </Button>
            </span>
          ) : null
        }
        description={t("networks.description")}
        title={t("networks.title")}
      />

      {networksQuery.isLoading ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
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
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {networks.map((network) => (
            <Card className="transition-shadow hover:shadow-md" key={network.id}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <NetworkIcon className="size-4 text-primary" />
                  {network.name}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                  <dt className="text-muted-foreground">{t("networks.networkName")}</dt>
                  <dd className="truncate font-mono text-xs">{network.networkName}</dd>
                  <dt className="text-muted-foreground">{t("networks.cidr")}</dt>
                  <dd className="font-mono text-xs">{network.ipv4Cidr}</dd>
                  <dt className="text-muted-foreground">{t("networks.devices")}</dt>
                  <dd>
                    {network.deviceCounts.approved} {t("networks.approved").toLowerCase()} ·{" "}
                    {network.deviceCounts.pending} {t("networks.pending").toLowerCase()} ·{" "}
                    {network.deviceCounts.blocked} {t("networks.blocked").toLowerCase()}
                  </dd>
                </dl>
                <Link
                  className="inline-flex text-sm font-medium text-primary hover:underline"
                  href={`/networks/${network.id}`}
                >
                  {t("networks.open")} →
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

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
                  id="network-name"
                  onChange={(event) => setName(event.target.value)}
                  required
                  value={name}
                />
              </Field>
              <Field className="gap-2">
                <FieldLabel htmlFor="network-cidr">{t("networks.cidr")}</FieldLabel>
                <Input
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
    </>
  )
}
