import type { Meta, StoryObj } from "@storybook/react-vite"

import { AppShell } from "@/components/layout/app-shell"

const meta = {
  title: "Layout/AppShell",
  component: AppShell,
  parameters: { layout: "fullscreen", location: "/networks" },
  render: () => (
    <AppShell>
      <div className="mx-auto max-w-[1180px] px-4 py-8">
        <h1 className="text-2xl font-semibold" id="page-title">
          Networks
        </h1>
        <p className="mt-1 text-sm text-fg-3">
          The real frame: skip link, desktop sidebar, phone top bar and the
          main-content landmark.
        </p>
        <div className="mt-6 rounded-xl bg-card p-4 ring-1 ring-line">
          Page content goes here.
        </div>
      </div>
    </AppShell>
  ),
} satisfies Meta<typeof AppShell>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
