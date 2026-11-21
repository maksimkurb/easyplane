import { Skeleton } from "@/components/ui/skeleton"
import { useTranslation } from "react-i18next"

/**
 * The frame the app opens into. Showing the real sidebar/heading/card shapes
 * instead of a full-screen "Loading…" makes the first paint feel like the app
 * is arriving rather than blocked.
 */
export function AppSkeleton() {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="hidden w-64 flex-none flex-col gap-4 border-r border-line bg-sidebar p-3 lg:flex">
        <Skeleton className="h-8 w-32" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="ml-4 h-7 w-3/4" />
          <Skeleton className="ml-4 h-7 w-2/3" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-14 items-center gap-3 border-b border-line px-4 lg:hidden">
          <Skeleton className="size-10 rounded-lg" />
          <Skeleton className="h-5 w-28" />
        </div>
        <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
          <Skeleton className="h-8 w-56 max-w-full" />
          <Skeleton className="mt-2 h-4 w-80 max-w-full" />
          <div className="mt-6 flex flex-col gap-2">
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
          </div>
        </main>
      </div>
      <span className="sr-only" role="status">
        {t("common.loading")}
      </span>
    </div>
  )
}
