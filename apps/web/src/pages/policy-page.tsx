import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, useParams } from "wouter"
import { ArrowLeftIcon, CheckCircle2Icon, ShieldIcon, XCircleIcon } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import {
  getGetNetworkPolicyQueryKey,
  getListNetworkPolicyVersionsQueryKey,
  getListDevicesQueryKey,
  getListTagsQueryKey,
  useCreateTag,
  useGetNetworkPolicy,
  useListDevices,
  useListNetworkPolicyVersions,
  useListNetworkRoutes,
  useListTags,
  usePreviewNetworkPolicy,
  useSaveNetworkPolicy,
  useValidateNetworkPolicy,
} from "@/api/generated/easyplane"
import type { PreviewNetworkPolicyBodyProtocol } from "@/api/generated/model"
import {
  EMPTY_POLICY_DOCUMENT as EMPTY_DOCUMENT,
  toPolicyDocument as toDocument,
  toStatementRows as toRows,
  type PolicyDocumentShape,
  type StatementRow,
} from "@/lib/policy-document"
import { useAuth } from "@/auth/auth-context"
import { PageHeader } from "@/components/shared/page-header"
import { SectionCard } from "@/components/shared/section-card"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/shared/field"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"

export function PolicyPage() {
  const { t } = useTranslation()
  const { id = "" } = useParams<{ id: string }>()
  const { canManage, isAdmin } = useAuth()
  const queryClient = useQueryClient()

  const policyQuery = useGetNetworkPolicy(id)
  const versionsQuery = useListNetworkPolicyVersions(id)
  const tagsQuery = useListTags()
  const devicesQuery = useListDevices({ networkId: id })
  const routesQuery = useListNetworkRoutes(id)

  const [mode, setMode] = useState<"form" | "json">("form")
  const [rows, setRows] = useState<StatementRow[]>([])
  const [base, setBase] = useState<PolicyDocumentShape>(EMPTY_DOCUMENT)
  const [text, setText] = useState("")
  const [note, setNote] = useState("")
  const [newTag, setNewTag] = useState("")
  const [warnings, setWarnings] = useState<string[]>([])
  const [compiled, setCompiled] = useState<
    Array<{ hostname: string; inboundRules: number; outboundRules: number; forwardRules: number; hash: string }>
  >([])
  const [target, setTarget] = useState<{ src: string; dst: string; cidr: string; port: string; proto: PreviewNetworkPolicyBodyProtocol }>({
    src: "",
    dst: "",
    cidr: "",
    port: "443",
    proto: "tcp",
  })
  const [decision, setDecision] = useState<
    | null
    | {
        allowed: boolean
        explanation: string[]
      }
  >(null)

  const active = policyQuery.data?.data?.policy ?? null
  const loadedVersion = active?.version ?? 0
  const [syncedVersion, setSyncedVersion] = useState<number | null>(null)

  // Load the active document into the editors once (and after each save).
  if (policyQuery.isSuccess && syncedVersion !== loadedVersion) {
    const document = (active?.document ?? EMPTY_DOCUMENT) as PolicyDocumentShape
    setBase(document)
    setRows(toRows(document))
    setText(JSON.stringify(document, null, 2))
    setSyncedVersion(loadedVersion)
  }

  const devices = devicesQuery.data?.data ?? []
  const tags = tagsQuery.data?.data ?? []
  const routes = routesQuery.data?.data
  const approvedCidrs = [...new Set((routes?.routes ?? []).filter((route) => route.state === "approved" && route.kind === "subnet").map((route) => route.cidr))]

  const currentDocument = useMemo<Record<string, unknown> | undefined>(
    () => (mode === "json" ? undefined : toDocument(rows, base)),
    [mode, rows, base],
  )

  const validate = useValidateNetworkPolicy({
    mutation: {
      onSuccess: (response) => {
        setWarnings(response.data.warnings)
        setCompiled(response.data.devices)
        toast.success(t("policy.valid"))
      },
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : t("common.error")),
    },
  })

  const save = useSaveNetworkPolicy({
    mutation: {
      onSuccess: async () => {
        toast.success(t("policy.saved"))
        setSyncedVersion(null)
        setNote("")
        await queryClient.invalidateQueries({ queryKey: getGetNetworkPolicyQueryKey(id) })
        await queryClient.invalidateQueries({ queryKey: getListNetworkPolicyVersionsQueryKey(id) })
        await queryClient.invalidateQueries({ queryKey: getListDevicesQueryKey() })
      },
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : t("common.error")),
    },
  })

  const preview = usePreviewNetworkPolicy({
    mutation: {
      onSuccess: (response) => {
        setDecision({
          allowed: response.data.reachability.allowed,
          explanation: response.data.reachability.explanation,
        })
        setWarnings(response.data.warnings)
      },
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : t("common.error")),
    },
  })

  const createTag = useCreateTag({
    mutation: {
      onSuccess: async () => {
        setNewTag("")
        await queryClient.invalidateQueries({ queryKey: getListTagsQueryKey() })
      },
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : t("common.error")),
    },
  })

  function currentText(): string {
    return mode === "json" ? text : JSON.stringify(currentDocument, null, 2)
  }

  function validateNow() {
    validate.mutate({
      networkId: id,
      data: mode === "json" ? { text } : { document: currentDocument ?? {} },
    })
  }

  function saveNow() {
    save.mutate({
      networkId: id,
      data: {
        ...(mode === "json" ? { text } : { document: currentDocument ?? {} }),
        ...(note ? { note } : {}),
      },
    })
  }

  function runPreview() {
    if (!target.src) {
      toast.error(t("policy.chooseSource"))
      return
    }
    preview.mutate({
      networkId: id,
      data: {
        ...(mode === "json" ? {} : { document: currentDocument ?? {} }),
        srcDeviceId: target.src,
        ...(target.dst ? { dstDeviceId: target.dst } : {}),
        ...(target.cidr ? { dstCidr: target.cidr } : {}),
        ...(target.port ? { port: Number(target.port) } : {}),
        protocol: target.proto,
      },
    })
  }

  if (policyQuery.isLoading) return <Skeleton className="h-64 w-full" />

  return (
    <>
      <PageHeader
        description={t("policy.description")}
        title={
          <span className="flex items-center gap-2">
            <Link className="text-muted-foreground hover:text-foreground" href={`/networks/${id}`}>
              <ArrowLeftIcon className="size-5" />
            </Link>
            <ShieldIcon className="size-5" />
            {t("policy.title")}
          </span>
        }
      />

      <Alert>
        <AlertDescription>{t("policy.honestNote")}</AlertDescription>
      </Alert>

      <div className="mt-4 grid gap-4">
        <SectionCard
          action={
            <Badge variant={loadedVersion > 0 ? "success" : "outline"}>
              {loadedVersion > 0
                ? t("policy.activeVersion", { version: loadedVersion })
                : t("policy.noPolicy")}
            </Badge>
          }
          description={t("policy.editorHint")}
          title={t("policy.editor")}
        >
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Button
              onClick={() => setMode("form")}
              size="sm"
              variant={mode === "form" ? "default" : "outline"}
            >
              {t("policy.formMode")}
            </Button>
            <Button
              onClick={() => {
                if (mode === "form") setText(JSON.stringify(currentDocument, null, 2))
                setMode("json")
              }}
              size="sm"
              variant={mode === "json" ? "default" : "outline"}
            >
              {t("policy.jsonMode")}
            </Button>
            <span className="text-xs text-muted-foreground">{t("policy.jsonHint")}</span>
          </div>

          {mode === "json" ? (
            <Textarea
              className="min-h-72 font-mono text-xs"
              onChange={(event) => setText(event.target.value)}
              spellCheck={false}
              value={text}
            />
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{t("policy.tags")}:</span>
                {tags.map((tag) => (
                  <Badge key={tag.id} variant="outline">
                    {tag.name}
                    <span className="ml-1 text-muted-foreground">{tag.deviceCount}</span>
                  </Badge>
                ))}
                {isAdmin ? (
                  <span className="flex items-center gap-1">
                    <Input
                      className="h-8 w-40"
                      onChange={(event) => setNewTag(event.target.value)}
                      placeholder="tag:server"
                      value={newTag}
                    />
                    <Button
                      disabled={newTag.trim() === ""}
                      onClick={() => createTag.mutate({ data: { name: newTag.trim() } })}
                      size="sm"
                      variant="outline"
                    >
                      {t("policy.addTag")}
                    </Button>
                  </span>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={base.options?.strictTags === true}
                    onCheckedChange={(checked) =>
                      setBase({
                        ...base,
                        options: { strictTags: checked === true },
                      })
                    }
                  />
                  {t("policy.strictTags")}
                </label>
                <span className="text-xs text-muted-foreground">
                  {t("policy.strictTagsHint")}
                </span>
              </div>

              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("policy.name")}</TableHead>
                      <TableHead>{t("policy.action")}</TableHead>
                      <TableHead>{t("policy.source")}</TableHead>
                      <TableHead>{t("policy.destination")}</TableHead>
                      <TableHead>{t("policy.proto")}</TableHead>
                      <TableHead>{t("policy.rateLimit")}</TableHead>
                      <TableHead className="text-right">{t("common.actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row, index) => (
                      <TableRow key={index}>
                        <TableCell>
                          <Input
                            className="h-8 w-36"
                            onChange={(event) =>
                              setRows(rows.map((entry, i) => (i === index ? { ...entry, name: event.target.value } : entry)))
                            }
                            value={row.name}
                          />
                        </TableCell>
                        <TableCell>
                          <Select
                            onValueChange={(value) =>
                              value &&
                              setRows(rows.map((entry, i) => (i === index ? { ...entry, action: value as "accept" | "deny" } : entry)))
                            }
                            value={row.action}
                          >
                            <SelectTrigger className="h-8 w-24">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="accept">{t("policy.allow")}</SelectItem>
                              <SelectItem value="deny">{t("policy.deny")}</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Input
                            className="h-8 w-48 font-mono text-xs"
                            onChange={(event) =>
                              setRows(rows.map((entry, i) => (i === index ? { ...entry, src: event.target.value } : entry)))
                            }
                            placeholder="tag:client, group:ops"
                            value={row.src}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            className="h-8 w-56 font-mono text-xs"
                            onChange={(event) =>
                              setRows(rows.map((entry, i) => (i === index ? { ...entry, dst: event.target.value } : entry)))
                            }
                            placeholder="tag:web:8080"
                            value={row.dst}
                          />
                        </TableCell>
                        <TableCell>
                          <Select
                            onValueChange={(value) =>
                              value &&
                              setRows(rows.map((entry, i) => (i === index ? { ...entry, proto: value as StatementRow["proto"] } : entry)))
                            }
                            value={row.proto}
                          >
                            <SelectTrigger className="h-8 w-24">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {["any", "tcp", "udp", "icmp"].map((proto) => (
                                <SelectItem key={proto} value={proto}>
                                  {proto}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Input
                            className="h-8 w-20"
                            onChange={(event) =>
                              setRows(rows.map((entry, i) => (i === index ? { ...entry, rateLimit: event.target.value } : entry)))
                            }
                            placeholder="0"
                            value={row.rateLimit}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            onClick={() => setRows(rows.filter((_, i) => i !== index))}
                            size="sm"
                            variant="ghost"
                          >
                            {t("common.delete")}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <Button
                onClick={() =>
                  setRows([
                    ...rows,
                    { name: "", action: "accept", src: "", dst: "", proto: "tcp", rateLimit: "", burst: "", stateful: false },
                  ])
                }
                size="sm"
                variant="outline"
              >
                {t("policy.addStatement")}
              </Button>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-end gap-2">
            <Field className="max-w-64 gap-1">
              <FieldLabel htmlFor="policy-note">{t("policy.note")}</FieldLabel>
              <Input
                id="policy-note"
                onChange={(event) => setNote(event.target.value)}
                value={note}
              />
            </Field>
            <Button disabled={validate.isPending} onClick={validateNow} variant="outline">
              {t("policy.validate")}
            </Button>
            {canManage ? (
              <Button disabled={save.isPending} onClick={saveNow}>
                {save.isPending ? t("common.loading") : t("policy.save")}
              </Button>
            ) : null}
          </div>

          {warnings.length > 0 ? (
            <Alert className="mt-3">
              <AlertDescription>
                <ul className="list-disc pl-4 text-xs">
                  {warnings.map((warning, index) => (
                    <li key={index}>{warning}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}

          {compiled.length > 0 ? (
            <div className="mt-3 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("devices.hostname")}</TableHead>
                    <TableHead>{t("policy.inbound")}</TableHead>
                    <TableHead>{t("policy.outbound")}</TableHead>
                    <TableHead>{t("policy.forward")}</TableHead>
                    <TableHead>{t("policy.compiledHash")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {compiled.map((entry) => (
                    <TableRow key={entry.hostname}>
                      <TableCell className="font-mono text-xs">{entry.hostname}</TableCell>
                      <TableCell>{entry.inboundRules}</TableCell>
                      <TableCell>{entry.outboundRules}</TableCell>
                      <TableCell>{entry.forwardRules}</TableCell>
                      <TableCell className="font-mono text-xs">{entry.hash}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}
        </SectionCard>

        <SectionCard description={t("policy.testHint")} title={t("policy.test")}>
          <FieldGroup className="gap-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field className="gap-1">
                <FieldLabel>{t("policy.source")}</FieldLabel>
                <Select
                  onValueChange={(value) => setTarget({ ...target, src: value ?? "" })}
                  value={target.src}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("policy.chooseSource")} />
                  </SelectTrigger>
                  <SelectContent>
                    {devices
                      .filter((device) => device.state === "approved")
                      .map((device) => (
                        <SelectItem key={device.id} value={device.id}>
                          {device.dnsName ?? device.hostname}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field className="gap-1">
                <FieldLabel>{t("policy.destination")}</FieldLabel>
                <Select
                  onValueChange={(value) => {
                    if (!value) return
                    setTarget({
                      ...target,
                      dst: approvedCidrs.includes(value) ? "" : value,
                      cidr: approvedCidrs.includes(value) ? value : "",
                    })
                  }}
                  value={target.cidr || target.dst}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("policy.chooseDestination")} />
                  </SelectTrigger>
                  <SelectContent>
                    {devices
                      .filter((device) => device.state === "approved")
                      .map((device) => (
                        <SelectItem key={device.id} value={device.id}>
                          {device.dnsName ?? device.hostname}
                        </SelectItem>
                      ))}
                    {approvedCidrs.map((cidr) => (
                      <SelectItem key={cidr} value={cidr}>
                        {t("policy.subnetRoute", { cidr })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field className="gap-1">
                <FieldLabel htmlFor="policy-port">{t("policy.port")}</FieldLabel>
                <Input
                  id="policy-port"
                  onChange={(event) => setTarget({ ...target, port: event.target.value })}
                  type="number"
                  value={target.port}
                />
              </Field>
              <Field className="gap-1">
                <FieldLabel>{t("policy.proto")}</FieldLabel>
                <Select
                  onValueChange={(value) =>
                    value &&
                    setTarget({ ...target, proto: value as PreviewNetworkPolicyBodyProtocol })
                  }
                  value={target.proto}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["tcp", "udp", "icmp"].map((proto) => (
                      <SelectItem key={proto} value={proto}>
                        {proto}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <FieldDescription>{t("policy.testSavedHint")}</FieldDescription>
            <Button className="w-fit" disabled={preview.isPending} onClick={runPreview} variant="outline">
              {t("policy.runTest")}
            </Button>
            {decision ? (
              <Alert className={decision.allowed ? "border-success/40" : "border-destructive/40"}>
                <AlertDescription className="flex flex-col gap-1">
                  <span className="flex items-center gap-2 font-medium">
                    {decision.allowed ? (
                      <CheckCircle2Icon className="size-4 text-success" />
                    ) : (
                      <XCircleIcon className="size-4 text-destructive" />
                    )}
                    {decision.allowed ? t("policy.allowed") : t("policy.denied")}
                  </span>
                  {decision.explanation.map((line, index) => (
                    <span className="font-mono text-xs" key={index}>
                      {line}
                    </span>
                  ))}
                </AlertDescription>
              </Alert>
            ) : null}
          </FieldGroup>
        </SectionCard>

        <SectionCard description={t("policy.versionsHint")} title={t("policy.versions")}>
          {(versionsQuery.data?.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("common.empty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>{t("policy.statements")}</TableHead>
                    <TableHead>{t("policy.tags")}</TableHead>
                    <TableHead>{t("policy.note")}</TableHead>
                    <TableHead>{t("common.created")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(versionsQuery.data?.data ?? []).map((version) => (
                    <TableRow key={version.id}>
                      <TableCell className="font-mono">{version.version}</TableCell>
                      <TableCell>{version.summary.statements}</TableCell>
                      <TableCell className="text-xs">
                        {version.summary.tags.join(", ") || t("common.none")}
                      </TableCell>
                      <TableCell className="max-w-64 truncate text-xs">
                        {version.note || t("common.none")}
                      </TableCell>
                      <TableCell className="text-xs">
                        {new Date(version.createdAt).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </SectionCard>

        <p className="text-xs text-muted-foreground">
          {t("policy.documentPreview")}
          <code className="mt-2 block max-h-64 overflow-auto rounded bg-muted p-2 text-[11px] whitespace-pre-wrap">
            {currentText()}
          </code>
        </p>
      </div>
    </>
  )
}
