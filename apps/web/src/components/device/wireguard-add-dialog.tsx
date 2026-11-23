import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useQueryClient } from "@tanstack/react-query"
import { TagIcon } from "lucide-react"
import { toast } from "sonner"

import {
  getGetDeviceQueryKey,
  getGetNetworkQueryKey,
  getListDevicesQueryKey,
  getListWireguardClientsQueryKey,
  useCreateWireguardClient,
  useListTags,
} from "@/api/generated/easyplane"
import type { ListWireguardClients200Item } from "@/api/generated/model"
import { OptionSelect } from "@/components/shared/option-select"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { tagLabel } from "@/lib/device-status"

export interface WireguardHubOption {
  id: string
  name: string
}

/**
 * Creates a portal client. The portal is enabled on the chosen hub implicitly
 * when needed (the API upgrades a disabled hub with the default port), so the
 * first-run flow is name → scan, not "configure a server first".
 */
export function WireguardAddDialog({
  networkId,
  hubs,
  open,
  onOpenChange,
  onCreated,
}: {
  networkId: string
  hubs: WireguardHubOption[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (client: ListWireguardClients200Item) => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [name, setName] = useState("")
  const [tags, setTags] = useState<string[]>([])
  const [hubId, setHubId] = useState(hubs.length === 1 ? hubs[0]!.id : "")
  const tagList = useListTags({ query: { enabled: open } })

  const create = useCreateWireguardClient({
    mutation: {
      onSuccess: async (response) => {
        toast.success(t("wireguard.created"))
        const created = response.data as unknown as ListWireguardClients200Item
        await queryClient.invalidateQueries({
          queryKey: getListWireguardClientsQueryKey(networkId),
        })
        await queryClient.invalidateQueries({
          queryKey: getListDevicesQueryKey(),
        })
        await queryClient.invalidateQueries({
          queryKey: getGetNetworkQueryKey(networkId),
        })
        if (created.hubDeviceId) {
          await queryClient.invalidateQueries({
            queryKey: getGetDeviceQueryKey(created.hubDeviceId),
          })
        }
        onOpenChange(false)
        reset()
        onCreated(created)
      },
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : t("common.error")),
    },
  })

  const reset = () => {
    setName("")
    setTags([])
    setHubId(hubs.length === 1 ? hubs[0]!.id : "")
  }

  const canSubmit =
    name.trim() !== "" && (hubs.length <= 1 || hubId !== "") && !create.isPending

  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
      open={open}
    >
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{t("wireguard.addTitle")}</DialogTitle>
          <DialogDescription>{t("wireguard.addDescription")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`wg-add-name-${networkId}`}>
              {t("wireguard.name")}
            </Label>
            <Input
              aria-describedby={`wg-add-name-hint-${networkId}`}
              autoComplete="off"
              className="h-11 sm:h-10"
              id={`wg-add-name-${networkId}`}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("wireguard.namePlaceholder")}
              value={name}
            />
            <p className="text-xs text-fg-3" id={`wg-add-name-hint-${networkId}`}>
              {t("wireguard.nameHint")}
            </p>
          </div>

          {hubs.length > 1 ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`wg-add-hub-${networkId}`}>
                {t("wireguard.hub")}
              </Label>
              <OptionSelect
                aria-describedby={`wg-add-hub-hint-${networkId}`}
                id={`wg-add-hub-${networkId}`}
                onValueChange={setHubId}
                options={hubs.map((hub) => ({
                  value: hub.id,
                  label: hub.name,
                }))}
                placeholder={t("wireguard.hub")}
                triggerClassName="h-11 sm:h-10"
                value={hubId}
              />
              <p className="text-xs text-fg-3" id={`wg-add-hub-hint-${networkId}`}>
                {t("wireguard.hubHint")}
              </p>
            </div>
          ) : hubs.length === 0 ? (
            <p className="rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn">
              {t("wireguard.noHub")}
            </p>
          ) : null}

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">{t("wireguard.tags")}</span>
            {(tagList.data?.data ?? []).length === 0 ? (
              <p className="text-xs text-fg-3">{t("wireguard.noTags")}</p>
            ) : (
              <div className="grid max-h-48 gap-1 overflow-y-auto">
                {(tagList.data?.data ?? []).map((tag) => (
                  <label
                    className="flex min-h-11 items-center gap-2.5 text-sm sm:min-h-8"
                    key={tag.id}
                  >
                    <Checkbox
                      checked={tags.includes(tag.name)}
                      onCheckedChange={(checked) =>
                        setTags((current) =>
                          checked === true
                            ? [...current, tag.name]
                            : current.filter((entry) => entry !== tag.name)
                        )
                      }
                    />
                    <span className="flex items-center gap-1.5 font-mono text-xs">
                      <TagIcon aria-hidden="true" className="size-3 text-fg-3" />
                      {tagLabel(tag.name)}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} variant="outline">
            {t("common.cancel")}
          </Button>
          <Button
            disabled={!canSubmit}
            onClick={() =>
              create.mutate({
                networkId,
                data: {
                  name: name.trim(),
                  ...(tags.length > 0 ? { tags } : {}),
                  ...(hubId ? { hubDeviceId: hubId } : {}),
                },
              })
            }
          >
            {t("wireguard.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
