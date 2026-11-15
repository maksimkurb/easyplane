import { useId, type ReactNode } from "react"
import { InfoIcon } from "lucide-react"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

export type OptionSelectOption = {
  value: string
  label: ReactNode
  disabled?: boolean
}

/**
 * A Select for a list that can legitimately be empty (no online devices, no
 * approved peers, …). With zero options the trigger is disabled, so pressing it
 * cannot open an empty popup, and a bordered inline hint explains what is
 * missing. A plain `Select` with an empty `SelectContent` leaves users with a
 * blank popup and no way to tell whether the list is loading or empty.
 */
export function OptionSelect({
  value,
  onValueChange,
  options,
  placeholder,
  empty,
  emptyClassName,
  disabled = false,
  id,
  className,
  triggerClassName,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
}: {
  value: string
  onValueChange: (value: string) => void
  options: OptionSelectOption[]
  placeholder?: ReactNode
  /** Inline hint shown instead of an empty popup. Omit to show nothing. */
  empty?: ReactNode
  emptyClassName?: string
  disabled?: boolean
  id?: string
  className?: string
  triggerClassName?: string
  "aria-label"?: string
  "aria-labelledby"?: string
  "aria-describedby"?: string
}) {
  const generatedId = useId()
  const isEmpty = options.length === 0
  const emptyHintId = `${id ?? generatedId}-empty`

  return (
    <div className={cn("space-y-1.5", className)}>
      <Select
        disabled={disabled || isEmpty}
        items={options.map((option) => ({
          label: option.label,
          value: option.value,
        }))}
        onValueChange={(next) => {
          if (typeof next === "string") onValueChange(next)
        }}
        value={value}
      >
        <SelectTrigger
          aria-describedby={
            isEmpty && empty ? emptyHintId : ariaDescribedBy
          }
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          className={triggerClassName}
          id={id}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem
              disabled={option.disabled}
              key={option.value}
              value={option.value}
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {isEmpty && empty ? (
        <SelectEmptyHint className={emptyClassName} id={emptyHintId}>
          {empty}
        </SelectEmptyHint>
      ) : null}
    </div>
  )
}

/** Compact, consistent "there is nothing to choose" message for selects. */
export function SelectEmptyHint({
  children,
  className,
  id,
}: {
  children: ReactNode
  className?: string
  id?: string
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg border border-dashed bg-muted/40 px-3 py-2 text-xs text-pretty text-muted-foreground [&_a]:font-medium [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:text-primary/80",
        className
      )}
      data-slot="select-empty"
      id={id}
      role="status"
    >
      <InfoIcon aria-hidden="true" className="mt-px size-3.5 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  )
}
