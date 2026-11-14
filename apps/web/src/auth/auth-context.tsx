/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo } from "react"
import { useQueryClient } from "@tanstack/react-query"

import {
  getGetAppConfigQueryKey,
  getGetMeQueryKey,
  useGetAppConfig,
  useGetMe,
  useLogout,
} from "@/api/generated/easyplane"
import type { GetAppConfig200, GetMe200 } from "@/api/generated/model"
import { AUTH_REQUIRED_EVENT } from "@/api/client"

export type Role = GetMe200["user"]["role"]

type AuthState = {
  me: GetMe200 | null
  config: GetAppConfig200 | null
  loading: boolean
  isAdmin: boolean
  canManage: boolean
  refresh: () => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient()
  const meQuery = useGetMe({
    query: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false },
  })
  const configQuery = useGetAppConfig({
    query: { retry: false, staleTime: 5 * 60_000 },
  })
  const logoutMutation = useLogout()

  useEffect(() => {
    const onAuthRequired = () => {
      void queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() })
    }
    window.addEventListener(AUTH_REQUIRED_EVENT, onAuthRequired)
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, onAuthRequired)
  }, [queryClient])

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() })
    await queryClient.invalidateQueries({ queryKey: getGetAppConfigQueryKey() })
  }, [queryClient])

  const logout = useCallback(async () => {
    try {
      await logoutMutation.mutateAsync()
    } finally {
      queryClient.clear()
      void queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() })
    }
  }, [logoutMutation, queryClient])

  const value = useMemo<AuthState>(() => {
    const me = meQuery.data?.data ?? null
    const role = me?.user.role ?? null
    return {
      me,
      config: configQuery.data?.data ?? null,
      loading: meQuery.isLoading,
      isAdmin: role === "admin",
      canManage: role === "admin" || role === "member",
      refresh,
      logout,
    }
  }, [configQuery.data, logout, meQuery.data, meQuery.isLoading, refresh])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error("useAuth must be used inside AuthProvider")
  return value
}
