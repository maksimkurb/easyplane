import { useTranslation } from "react-i18next"
import { RefreshCwIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import type { useAwgConfig } from "@/hooks/use-awg-config"

export function WireguardAwgOptions({
  awg,
}: {
  awg: ReturnType<typeof useAwgConfig>
}) {
  const { t } = useTranslation()
  return (
    <div className="flex w-full flex-col gap-1.5 text-sm">
      <label className="flex min-h-11 items-center gap-2.5 sm:min-h-8">
        <Checkbox
          checked={awg.fullTunnel}
          onCheckedChange={(checked) => awg.setFullTunnel(checked === true)}
        />
        <span>{t("wireguard.fullTunnel.label")}</span>
      </label>
      <p className="text-pretty text-xs text-fg-3">
        {t("wireguard.fullTunnel.hint")}
      </p>
      <label className="flex min-h-11 items-center gap-2.5 sm:min-h-8">
        <Checkbox
          checked={awg.enabled}
          onCheckedChange={(checked) => awg.setEnabled(checked === true)}
        />
        <span>{t("wireguard.awg.label")}</span>
      </label>
      {awg.enabled ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-fg-3">
          <span className="font-mono">
            Jc={awg.params.jc} Jmin={awg.params.jmin} Jmax={awg.params.jmax}
          </span>
          <Button
            onClick={awg.regenerate}
            size="sm"
            type="button"
            variant="ghost"
          >
            <RefreshCwIcon aria-hidden="true" className="size-3.5" />
            {t("wireguard.awg.regenerate")}
          </Button>
        </div>
      ) : null}
      <p className="text-pretty text-xs text-fg-3">{t("wireguard.awg.hint")}</p>
    </div>
  )
}
