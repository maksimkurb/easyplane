import type { Meta, StoryObj } from "@storybook/react-vite"
import { useEffect } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Toaster } from "@/components/ui/sonner"

function ToastDemo({ kind }: { kind: "success" | "error" | "info" }) {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (kind === "success") toast.success("Device approved")
      else if (kind === "error") toast.error("Could not push configuration")
      else toast("Route request queued")
    }, 0)
    return () => window.clearTimeout(timer)
  }, [kind])

  return (
    <>
      <Toaster />
      <Button
        onClick={() =>
          toast.success("Device approved", {
            description: "nas-01 can join the network now.",
            action: { label: "Undo", onClick: () => undefined },
          })
        }
        variant="outline"
      >
        Show toast
      </Button>
    </>
  )
}

const meta = {
  title: "UI/Toaster",
  component: Toaster,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Toaster>

export default meta
type Story = StoryObj<typeof meta>

export const Success: Story = { render: () => <ToastDemo kind="success" /> }

export const Error: Story = { render: () => <ToastDemo kind="error" /> }

export const Info: Story = { render: () => <ToastDemo kind="info" /> }
