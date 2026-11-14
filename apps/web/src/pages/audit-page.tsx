import { useTranslation } from "react-i18next"
import { ScrollTextIcon } from "lucide-react"

import { useListAuditLog } from "@/api/generated/easyplane"
import { useAuth } from "@/auth/auth-context"
import { PageHeader } from "@/components/shared/page-header"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export function AuditPage() {
  const { t } = useTranslation()
  const { isAdmin } = useAuth()
  const query = useListAuditLog({ limit: 100 }, { query: { enabled: isAdmin } })
  const entries = query.data?.data ?? []

  if (!isAdmin) {
    return (
      <p className="text-sm text-muted-foreground">{t("common.forbidden")}</p>
    )
  }

  return (
    <>
      <PageHeader description={t("audit.description")} title={t("audit.title")} />
      {query.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : entries.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ScrollTextIcon />
            </EmptyMedia>
            <EmptyTitle>{t("audit.title")}</EmptyTitle>
            <EmptyDescription>{t("audit.empty")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("audit.when")}</TableHead>
                <TableHead>{t("audit.action")}</TableHead>
                <TableHead>{t("audit.actor")}</TableHead>
                <TableHead>{t("audit.target")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="text-xs whitespace-nowrap">
                    {new Date(entry.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{entry.action}</TableCell>
                  <TableCell className="text-xs">
                    {entry.actorUserId ? (
                      <span className="font-mono">{entry.actorUserId.slice(0, 8)}</span>
                    ) : (
                      entry.actorType
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    {entry.targetType}
                    {entry.targetId ? (
                      <span className="font-mono text-muted-foreground">
                        {" "}
                        {entry.targetId.slice(0, 8)}
                      </span>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  )
}
