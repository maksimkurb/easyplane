import { useTranslation } from "react-i18next"

import type { AccessMode } from "@/lib/access-policy"
import { Segmented } from "@/components/ui/segmented"

export function AccessModeSwitch({
  value,
  onChange,
  disabled = false,
}: {
  value: AccessMode
  onChange: (mode: AccessMode) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  return (
    <Segmented
      className="[&>button]:h-9 [&>button]:px-3.5 max-sm:w-full max-sm:[&>button]:flex-1"
      label={t("accessA.mode.label")}
      onValueChange={onChange}
      options={[
        { value: "open" as const, label: t("accessA.mode.open"), disabled },
        { value: "rules" as const, label: t("accessA.mode.rules"), disabled },
        { value: "json" as const, label: t("accessA.mode.json"), disabled },
      ]}
      value={value}
    />
  )
}
