import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"

import { TopBar } from "@/components/layout/top-bar"

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-screen w-full max-w-full flex-col overflow-x-clip bg-background">
      <a
        className="sr-only z-50 rounded-md bg-card px-3 py-2 text-sm font-medium shadow focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        href="#main-content"
      >
        {t("common.skipToContent")}
      </a>
      <TopBar />
      <main className="min-w-0 flex-1" id="main-content">
        {children}
      </main>
    </div>
  )
}
