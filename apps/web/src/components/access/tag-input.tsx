import { useId, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { mergeValues, splitValues } from "@/lib/access-policy"

/**
 * Values become pills as they are typed, pasted or committed with Enter or
 * blur. Validation is per pill: the first invalid value renders one error line
 * under the field and the pill itself turns red/dashed. No tooltips, counters or
 * per-pill messages.
 */
export function TagInput({
  values,
  onChange,
  label,
  placeholder,
  disabled = false,
  invalid = false,
  validate,
  isRange,
  inputMode = "text",
  id,
  className,
  "data-testid": testId,
}: {
  values: string[]
  onChange: (values: string[]) => void
  label: string
  placeholder?: string
  disabled?: boolean
  invalid?: boolean
  validate: (value: string) => string | null
  isRange?: (value: string) => boolean
  inputMode?: "text" | "numeric"
  id?: string
  className?: string
  "data-testid"?: string
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState("")
  const generatedId = useId()
  const inputId = id ?? generatedId
  const inputRef = useRef<HTMLInputElement>(null)
  const errorLineId = `${inputId}-error`

  const pillErrors = values.map((value) => validate(value))
  const firstError = pillErrors.find(
    (message): message is string => message !== null
  )

  const commit = (nextValues: readonly string[], nextDraft: string) => {
    onChange(mergeValues(values, nextValues))
    setDraft(nextDraft)
  }

  const onInput = (value: string) => {
    if (/[\s,]/.test(value)) {
      const ends = /[\s,]$/.test(value)
      const parts = splitValues(value)
      const keep = ends ? "" : (parts.pop() ?? "")
      commit(parts, keep)
      return
    }
    setDraft(value)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault()
      commit(splitValues(draft), "")
      return
    }
    if (event.key === "Backspace" && draft === "" && values.length > 0) {
      event.preventDefault()
      onChange(values.slice(0, -1))
    }
  }

  const onPaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData("text")
    if (!text) return
    event.preventDefault()
    commit(splitValues(`${draft} ${text}`), "")
  }

  return (
    <div className={cn("min-w-0", className)}>
      <div
        className={cn(
          "flex min-h-9 min-w-0 cursor-text flex-wrap items-center gap-1 rounded-lg bg-card px-1.5 py-1 shadow-[inset_0_0_0_1px_var(--line-2)]",
          "focus-within:shadow-[inset_0_0_0_1.5px_var(--brand),0_0_0_3px_var(--brand-soft)]",
          invalid && "shadow-[inset_0_0_0_1.5px_var(--err)]",
          disabled && "cursor-not-allowed bg-surface-2",
          "max-sm:min-h-12 max-sm:px-2 max-sm:py-1.5"
        )}
        data-testid={testId}
        onClick={() => inputRef.current?.focus()}
      >
        {values.map((value, index) => {
          const message = pillErrors[index]
          const range = isRange?.(value) === true
          return (
            <span
              className={cn(
                "inline-flex h-6 max-w-full items-center rounded-md bg-surface-3 pl-2 font-mono text-[12.5px] leading-6",
                range &&
                  "bg-brand-soft text-brand-text outline-1 outline-brand/60 outline-dashed",
                message !== null &&
                  "bg-err-soft text-err shadow-[inset_0_0_0_1px_var(--err-line)]"
              )}
              key={`${value}-${index}`}
            >
              <span className="whitespace-nowrap">{value}</span>
              <button
                aria-label={t("accessA.tagInput.remove", { value })}
                className="relative ml-0.5 grid size-6 flex-none place-items-center rounded-r-md opacity-75 after:absolute after:-inset-2.5 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                disabled={disabled}
                onClick={(event) => {
                  event.stopPropagation()
                  onChange(values.filter((_, position) => position !== index))
                }}
                type="button"
              >
                <XIcon aria-hidden="true" className="size-3" />
              </button>
            </span>
          )
        })}
        <input
          aria-describedby={firstError ? errorLineId : undefined}
          aria-invalid={firstError ? true : undefined}
          aria-label={label}
          autoComplete="off"
          className="h-6 min-w-[72px] flex-1 border-0 bg-transparent px-1 font-mono text-[13px] text-foreground outline-0 placeholder:text-fg-3 disabled:cursor-not-allowed max-sm:h-8 max-sm:text-base"
          disabled={disabled}
          id={inputId}
          inputMode={inputMode}
          onBlur={() => {
            if (draft.trim()) commit(splitValues(draft), "")
          }}
          onChange={(event) => onInput(event.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder={values.length === 0 ? placeholder : undefined}
          ref={inputRef}
          spellCheck={false}
          value={draft}
        />
      </div>
      <div
        aria-live="polite"
        className={cn(
          "text-[12.5px] leading-[18px] text-fg-2",
          firstError !== null ? "mt-1 text-err" : "sr-only"
        )}
        id={errorLineId}
        role="status"
      >
        {firstError ?? ""}
      </div>
    </div>
  )
}
