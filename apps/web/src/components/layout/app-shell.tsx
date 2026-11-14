import { useEffect, useRef, useState } from "react"
import type { ReactNode } from "react"

import { useLocation } from "wouter"

import { AppSidebar } from "@/components/app-sidebar"
import { AppBrandHeader } from "@/components/layout/app-brand-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { useSidebar } from "@/components/ui/sidebar-context"

export function AppShell({ children }: { children: ReactNode }) {
  const [pathname] = useLocation()

  return (
    <SidebarProvider defaultOpen={true}>
      <div className="flex min-h-screen w-full max-w-full overflow-x-clip bg-muted/20">
        <a
          className="sr-only z-50 rounded-md bg-background px-3 py-2 text-sm font-medium shadow focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
          href="#main-content"
        >
          Skip to content
        </a>
        <AppSidebar />
        <SidebarInset className="max-w-full min-w-0 overflow-x-clip">
          <MobileSidebarHeader key={pathname} />
          <main
            aria-labelledby="page-title"
            className="min-w-0 flex-1"
            id="main-content"
          >
            <div className="mx-auto max-w-7xl min-w-0 px-4 py-4">{children}</div>
          </main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  )
}

function MobileSidebarHeader() {
  const { toggleSidebar } = useSidebar()
  const [hidden, setHidden] = useState(false)
  const headerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let lastChangeY = window.scrollY
    const onScroll = () => {
      if (headerRef.current?.contains(document.activeElement)) {
        setHidden(false)
        return
      }
      const nextHidden =
        window.scrollY > lastChangeY && window.scrollY > 40
          ? true
          : window.scrollY < lastChangeY
            ? false
            : null
      if (nextHidden === null) return
      setHidden(nextHidden)
      lastChangeY = window.scrollY
    }
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  return (
    <div
      aria-hidden={hidden}
      className={`sticky top-0 z-30 border-b bg-background shadow-sm transition-transform duration-200 motion-reduce:transition-none md:hidden ${hidden ? "-translate-y-full" : "translate-y-0"}`}
      inert={hidden}
      onFocusCapture={() => setHidden(false)}
      ref={headerRef}
    >
      <div className="px-4 pt-[calc(env(safe-area-inset-top)+0.5rem)] pb-2">
        <AppBrandHeader onMenuClick={toggleSidebar} />
      </div>
    </div>
  )
}
