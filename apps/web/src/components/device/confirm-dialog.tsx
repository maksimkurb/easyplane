import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

/**
 * One-question confirmation for an action that cannot be undone. Following the
 * HIG, Cancel is the default (focused) button; the destructive button is never
 * the one <kbd>Enter</kbd> presses by accident. Reversible actions should use a
 * toast with Undo instead of this dialog.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  destructive = false,
  pending = false,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmLabel: string
  cancelLabel?: string
  destructive?: boolean
  pending?: boolean
  onConfirm: () => void
}) {
  const { t } = useTranslation()
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            autoFocus
            onClick={() => onOpenChange(false)}
            type="button"
            variant="outline"
          >
            {cancelLabel ?? t("common.cancel")}
          </Button>
          <Button
            disabled={pending}
            onClick={onConfirm}
            variant={destructive ? "destructive" : "default"}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
