import { useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import {
  getListWireguardClientsQueryKey,
  useGetWireguardClientConfig,
} from "@/api/generated/easyplane"
import type { ListWireguardClients200Item } from "@/api/generated/model"

/** Fetches config on demand for the currently opened client. */
export function useWireguardConfigDialogState() {
  const [target, setTarget] = useState<ListWireguardClients200Item | null>(null)
  const open = target !== null
  const configQuery = useGetWireguardClientConfig(target?.id ?? "", {
    query: { enabled: open, retry: false, gcTime: 0, staleTime: 0 },
  })
  const close = () => setTarget(null)
  return {
    target,
    open,
    show: (client: ListWireguardClients200Item) => setTarget(client),
    close,
    onOpenChange: (next: boolean) => {
      if (!next) close()
    },
    config: configQuery.data?.data.config ?? null,
    loading: configQuery.isLoading,
    error: (configQuery.error as Error | null) ?? null,
    retry: () => void configQuery.refetch(),
  }
}

export function useInvalidateWireguardClients(networkId: string) {
  const queryClient = useQueryClient()
  return async () => {
    await queryClient.invalidateQueries({
      queryKey: getListWireguardClientsQueryKey(networkId),
    })
  }
}
