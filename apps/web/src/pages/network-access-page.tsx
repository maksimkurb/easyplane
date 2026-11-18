import { useState } from "react"
import { useTranslation } from "react-i18next"
import {
  BracesIcon,
  CheckCircle2Icon,
  ListChecksIcon,
  NetworkIcon,
} from "lucide-react"

import {
  useGetPolicySubjects,
  useListNetworkPolicyVersions,
  useListUsers,
} from "@/api/generated/easyplane"
import type { GetPolicySubjects200 } from "@/api/generated/model"
import { useAuth } from "@/auth/auth-context"
import {
  NetworkShell,
  type NetworkShellData,
} from "@/components/network/network-shell"
import {
  AccessSubnets,
  AccessTagsGroups,
  AccessTools,
} from "@/components/access/access-accordions"
import { AccessJsonEditor } from "@/components/access/access-json-editor"
import {
  AccessModeSwitch,
  ModeChangeDialog,
} from "@/components/access/access-mode-switch"
import { AccessRules } from "@/components/access/access-rules"
import { Button } from "@/components/ui/button"
import { Segmented } from "@/components/ui/segmented"
import { Skeleton } from "@/components/ui/skeleton"
import { useAccessPolicy } from "@/hooks/use-access-policy"

const EMPTY_SUBJECTS: GetPolicySubjects200 = {
  devices: [],
  tags: [],
  userGroups: [],
  subnets: [],
  hosts: [],
}

type DataTab = "rules" | "data" | "subnets"

export function NetworkAccessPage({ networkId }: { networkId: string }) {
  return (
    <NetworkShell networkId={networkId} tab="access">
      {(data) => <AccessTab data={data} />}
    </NetworkShell>
  )
}

function AccessTab({ data }: { data: NetworkShellData }) {
  const { t } = useTranslation()
  const networkId = data.network.id
  const { isAdmin, canManage } = useAuth()
  const editor = useAccessPolicy(networkId)
  const subjectsQuery = useGetPolicySubjects(networkId)
  const versionsQuery = useListNetworkPolicyVersions(networkId)
  const usersQuery = useListUsers({ query: { enabled: isAdmin } })

  const subjects = subjectsQuery.data?.data ?? EMPTY_SUBJECTS
  const versions = versionsQuery.data?.data ?? []
  const users = usersQuery.data?.data ?? []
  const canEdit = isAdmin

  const [tab, setTab] = useState<DataTab>("rules")
  const [highlightIndex, setHighlightIndex] = useState<number | null>(null)
  const [jsonConfirm, setJsonConfirm] = useState(false)

  if (editor.loading || (subjectsQuery.isLoading && !subjectsQuery.data)) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    )
  }

  if (subjectsQuery.isError && !subjectsQuery.data) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-xl bg-card p-4 shadow-sm ring-1 ring-line">
        <p className="text-sm text-fg-2">{t("common.error")}</p>
        <Button
          onClick={() => void subjectsQuery.refetch()}
          size="sm"
          variant="outline"
        >
          {t("common.retry")}
        </Button>
      </div>
    )
  }

  const jsonMode = editor.mode === "json"

  const toggleJson = () => {
    if (jsonMode) {
      void editor.changeMode("rules")
      return
    }
    if (editor.mode === "open") {
      setJsonConfirm(true)
      return
    }
    void editor.changeMode("json")
  }

  return (
    <div
      className="flex min-w-0 flex-col gap-3 max-sm:-mx-1"
      data-testid="access-page"
    >
      <AccessModeSwitch
        disabled={!canEdit || editor.saving}
        onChange={(next) => void editor.changeMode(next)}
        value={editor.mode}
      />

      {editor.generalError ? (
        <p
          aria-live="assertive"
          className="rounded-lg bg-err-soft px-3 py-2 text-[12.5px] leading-[18px] text-err ring-1 ring-err-line"
          role="alert"
        >
          {editor.generalError}
        </p>
      ) : null}

      {editor.mode === "open" ? (
        <section
          className="flex min-w-0 items-start gap-2 rounded-xl bg-ok-soft/60 px-3 py-2.5 text-[13px] leading-[18px] text-fg-2 ring-1 ring-line"
          data-testid="access-open-note"
        >
          <CheckCircle2Icon
            aria-hidden="true"
            className="mt-0.5 size-4 flex-none text-ok"
          />
          <p className="min-w-0">
            <span className="font-medium text-foreground">
              {t("accessA.open.nothingBlocked")}.
            </span>{" "}
            {t("accessA.open.rulesKept")}
          </p>
        </section>
      ) : null}

      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {jsonMode ? (
          <p className="min-w-0 flex-1 text-[12.5px] leading-[18px] text-fg-2">
            {t("accessA.json.hint")}
          </p>
        ) : (
          <Segmented
            className="min-w-0 max-sm:w-full max-sm:[&>button]:flex-1"
            label={t("accessA.tabs.label")}
            onValueChange={setTab}
            options={[
              {
                value: "rules" as const,
                label: (
                  <span className="inline-flex items-center gap-1.5">
                    <ListChecksIcon aria-hidden="true" className="size-4" />
                    {t("accessA.tabs.rules")}
                    <span className="text-[12px] font-normal text-fg-3">
                      {editor.document.rules.length}
                    </span>
                  </span>
                ),
              },
              {
                value: "data" as const,
                label: (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="sm:hidden">
                      {t("accessA.tabs.dataShort")}
                    </span>
                    <span className="max-sm:hidden">
                      {t("accessA.tabs.data")}
                    </span>
                    <span className="text-[12px] font-normal text-fg-3">
                      {subjects.tags.length + subjects.userGroups.length}
                    </span>
                  </span>
                ),
              },
              {
                value: "subnets" as const,
                label: (
                  <span className="inline-flex items-center gap-1.5">
                    <NetworkIcon aria-hidden="true" className="size-4" />
                    {t("accessA.tabs.subnets")}
                  </span>
                ),
              },
            ]}
            value={tab}
          />
        )}
        <div className="ml-auto flex min-w-0 flex-wrap items-center gap-1.5 max-sm:ml-0">
          <AccessTools
            canAdmin={canEdit}
            canTest={canManage}
            mode={editor.mode}
            networkId={networkId}
            onHighlightRule={(index) => {
              setHighlightIndex(index)
              if (index !== null) setTab("rules")
            }}
            refresh={editor.refresh}
            rules={editor.document.rules}
            subjects={subjects}
            users={users}
            versions={versions}
          />
          <Button
            aria-pressed={jsonMode}
            disabled={!canEdit || editor.saving}
            onClick={toggleJson}
            size="sm"
            type="button"
            variant="outline"
          >
            <BracesIcon aria-hidden="true" />
            {jsonMode
              ? t("accessA.json.backToRules")
              : t("accessA.json.toggle")}
          </Button>
        </div>
      </div>

      {jsonMode ? (
        <AccessJsonEditor
          canEdit={canEdit}
          document={editor.document}
          key={editor.version}
          networkId={networkId}
          onSaved={() => editor.refresh()}
        />
      ) : null}

      {!jsonMode && tab === "rules" ? (
        <AccessRules
          busy={editor.saving}
          canEdit={canEdit}
          chains={editor.document.chains}
          enforced={editor.mode !== "open"}
          errors={editor.ruleErrors}
          generalError={editor.generalError}
          highlightIndex={highlightIndex}
          networkId={networkId}
          onChangeChain={editor.changeChain}
          onChangeRule={editor.updateRule}
          onCreateRule={editor.addRule}
          onDeleteRule={editor.deleteRule}
          onDuplicateRule={editor.duplicateRule}
          onMoveRule={editor.moveRule}
          onReorderRule={editor.reorderRule}
          onSaveRule={editor.saveWholeRule}
          onUndoDelete={editor.insertRule}
          rules={editor.document.rules}
          subjects={subjects}
        />
      ) : null}

      {!jsonMode && tab === "data" ? (
        <AccessTagsGroups
          canEdit={canEdit}
          refresh={editor.refresh}
          subjects={subjects}
        />
      ) : null}

      {!jsonMode && tab === "subnets" ? (
        <AccessSubnets subjects={subjects} />
      ) : null}

      <ModeChangeDialog
        onConfirm={() => {
          setJsonConfirm(false)
          void editor.changeMode("json")
        }}
        onOpenChange={setJsonConfirm}
        open={jsonConfirm}
        target="rules"
      />
    </div>
  )
}
