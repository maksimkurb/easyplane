import { useMemo } from "react"
import { useTranslation } from "react-i18next"

import {
  useGetPolicySubjects,
  useListNetworkPolicyVersions,
  useListUsers,
} from "@/api/generated/easyplane"
import type { GetPolicySubjects200 } from "@/api/generated/model"
import { useAuth } from "@/auth/auth-context"
import { NetworkShell, type NetworkShellData } from "@/components/network/network-shell"
import { AccessAccordions } from "@/components/access/access-accordions"
import { AccessJsonEditor } from "@/components/access/access-json-editor"
import { AccessModeSwitch } from "@/components/access/access-mode-switch"
import { AccessRules } from "@/components/access/access-rules"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useAccessPolicy } from "@/hooks/use-access-policy"

const EMPTY_SUBJECTS: GetPolicySubjects200 = {
  devices: [],
  tags: [],
  userGroups: [],
  subnets: [],
  hosts: [],
}

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
  const { isAdmin } = useAuth()
  const editor = useAccessPolicy(networkId)
  const subjectsQuery = useGetPolicySubjects(networkId)
  const versionsQuery = useListNetworkPolicyVersions(networkId)
  const usersQuery = useListUsers({ query: { enabled: isAdmin } })

  const subjects = subjectsQuery.data?.data ?? EMPTY_SUBJECTS
  const versions = useMemo(() => versionsQuery.data?.data ?? [], [versionsQuery.data])
  const users = usersQuery.data?.data ?? []
  const canEdit = isAdmin

  if (editor.loading || (subjectsQuery.isLoading && !subjectsQuery.data)) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-9 w-64 rounded-[10px]" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    )
  }

  if (subjectsQuery.isError && !subjectsQuery.data) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-xl bg-card p-4 shadow-sm ring-1 ring-line">
        <p className="text-sm text-fg-2">{t("common.error")}</p>
        <Button onClick={() => void subjectsQuery.refetch()} size="sm" variant="outline">
          {t("common.retry")}
        </Button>
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-3 max-sm:-mx-1" data-testid="access-page">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <AccessModeSwitch
          disabled={!canEdit || editor.saving}
          onChange={(next) => void editor.changeMode(next)}
          value={editor.mode}
        />
      </div>

      {editor.mode !== "rules" && editor.generalError ? (
        <p
          aria-live="assertive"
          className="rounded-lg bg-err-soft px-3 py-2 text-[12.5px] leading-[18px] text-err ring-1 ring-err-line"
          role="alert"
        >
          {editor.generalError}
        </p>
      ) : null}

      {editor.mode === "open" ? (
        <section className="rounded-xl bg-card p-3 shadow-sm ring-1 ring-line">
          <p className="text-sm">{t("accessA.open.nothingBlocked")}</p>
        </section>
      ) : null}

      {editor.mode === "json" ? (
        <AccessJsonEditor
          canEdit={canEdit}
          document={editor.document}
          key={editor.version}
          networkId={networkId}
          onSaved={() => editor.refresh()}
        />
      ) : null}

      {editor.mode === "rules" ? (
        <>
          <AccessRules
            busy={editor.saving}
            canEdit={canEdit}
            chains={editor.document.chains}
            errors={editor.ruleErrors}
            generalError={editor.generalError}
            networkId={networkId}
            onAddRule={editor.addRule}
            onChangeChain={editor.changeChain}
            onChangeChains={editor.changeChains}
            onChangeRule={editor.updateRule}
            onDeleteRule={editor.deleteRule}
            onDuplicateRule={editor.duplicateRule}
            onMoveRule={editor.moveRule}
            onReorderRule={editor.reorderRule}
            rules={editor.document.rules}
            subjects={subjects}
          />
          <AccessAccordions
            canEdit={canEdit}
            mode={editor.mode}
            networkId={networkId}
            refresh={editor.refresh}
            subjects={subjects}
            users={users}
            versions={versions}
          />
        </>
      ) : null}
    </div>
  )
}
