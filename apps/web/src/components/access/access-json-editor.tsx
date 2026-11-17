import { useState } from "react"
import { useTranslation } from "react-i18next"

import type { AccessDocument } from "@/lib/access-policy"
import { useSaveNetworkPolicy, useValidateNetworkPolicy } from "@/api/generated/easyplane"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

export function AccessJsonEditor({
  networkId,
  document,
  canEdit,
  onSaved,
}: {
  networkId: string
  document: AccessDocument
  canEdit: boolean
  onSaved: (version: number) => Promise<void> | void
}) {
  const { t } = useTranslation()
  const [text, setText] = useState(() =>
    JSON.stringify({ ...document, mode: "json" }, null, 2)
  )
  const [error, setError] = useState<string>()
  const [warnings, setWarnings] = useState<string[]>([])
  const [valid, setValid] = useState(false)
  const validate = useValidateNetworkPolicy()
  const save = useSaveNetworkPolicy()

  const runValidate = () => {
    setError(undefined)
    setValid(false)
    validate.mutate(
      { networkId, data: { text } },
      {
        onSuccess: (response) => {
          setWarnings(response.data.warnings)
          setValid(true)
        },
        onError: (cause) =>
          setError(cause instanceof Error ? cause.message : t("common.error")),
      }
    )
  }

  const saveNow = () => {
    setError(undefined)
    save.mutate(
      { networkId, data: { text, mode: "json" } },
      {
        onSuccess: async (response) => {
          setValid(false)
          setWarnings([])
          await onSaved(response.data.policy.version)
        },
        onError: (cause) =>
          setError(cause instanceof Error ? cause.message : t("common.error")),
      }
    )
  }

  return (
    <section
      className="flex min-w-0 flex-col gap-2 rounded-xl bg-card p-3 shadow-sm ring-1 ring-line"
      data-testid="json-editor"
    >
      <Textarea
        aria-invalid={error ? true : undefined}
        aria-label={t("policy.jsonMode")}
        className="min-h-80 font-mono text-xs leading-5"
        onChange={(event) => {
          setText(event.target.value)
          setError(undefined)
          setValid(false)
        }}
        readOnly={!canEdit}
        spellCheck={false}
        value={text}
      />
      {error ? (
        <p aria-live="assertive" className="text-[12.5px] leading-[18px] text-err" role="alert">
          {error}
        </p>
      ) : null}
      {valid ? (
        <p aria-live="polite" className="text-[12.5px] leading-[18px] text-ok">
          {t("accessA.json.valid")}
        </p>
      ) : null}
      {warnings.length > 0 ? (
        <ul className="list-disc pl-4 text-[12.5px] leading-[18px] text-fg-2">
          {warnings.map((warning, index) => (
            <li className="[overflow-wrap:anywhere]" key={index}>
              {warning}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={!canEdit || validate.isPending}
          onClick={runValidate}
          size="sm"
          type="button"
          variant="outline"
        >
          {t("accessA.json.validate")}
        </Button>
        {canEdit ? (
          <Button
            disabled={save.isPending}
            onClick={saveNow}
            size="sm"
            type="button"
          >
            {save.isPending ? t("common.loading") : t("accessA.json.save")}
          </Button>
        ) : null}
      </div>
    </section>
  )
}
