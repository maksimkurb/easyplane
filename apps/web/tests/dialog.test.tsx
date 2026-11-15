import { describe, expect, it } from "vitest"
import { screen } from "@testing-library/react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { renderWithProviders } from "./test-utils"

function renderDialog(size?: "sm" | "md" | "lg" | "xl") {
  return renderWithProviders(
    <Dialog open>
      <DialogContent size={size}>
        <DialogHeader>
          <DialogTitle>Title</DialogTitle>
          <DialogDescription>Description</DialogDescription>
        </DialogHeader>
        <div>Body</div>
        <DialogFooter>
          <button type="button">Confirm</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function popup() {
  return document.querySelector('[data-slot="dialog-content"]')
}

describe("Dialog", () => {
  it("is capped to the viewport and scrolls its body instead of overflowing", () => {
    renderDialog()

    const content = popup()
    expect(content).not.toBeNull()
    expect(content).toHaveClass("max-h-[calc(100dvh-1rem)]")
    expect(content).toHaveClass("sm:max-h-[90dvh]")
    expect(content).toHaveClass("overflow-hidden")

    const body = document.querySelector('[data-slot="dialog-body"]')
    expect(body).toHaveClass("overflow-y-auto")
    expect(body).toContainElement(screen.getByText("Body"))
  })

  it("defaults to a wide dialog and supports explicit sizes", () => {
    const { unmount } = renderDialog()
    expect(popup()).toHaveClass("sm:max-w-2xl")
    unmount()

    const { unmount: unmountLarge } = renderDialog("lg")
    expect(popup()).toHaveClass("sm:max-w-4xl")
    unmountLarge()

    const { unmount: unmountSmall } = renderDialog("sm")
    expect(popup()).toHaveClass("sm:max-w-md")
    unmountSmall()
  })

  it("keeps the header and footer visible while the body scrolls", () => {
    renderDialog()

    expect(document.querySelector('[data-slot="dialog-header"]')).toHaveClass(
      "sticky"
    )
    expect(document.querySelector('[data-slot="dialog-footer"]')).toHaveClass(
      "sticky"
    )
  })
})
