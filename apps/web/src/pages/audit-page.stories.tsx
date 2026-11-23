import type { Meta, StoryObj } from "@storybook/react-vite"

import { AppShell } from "@/components/layout/app-shell"
import { AuditPage } from "@/pages/audit-page"

const meta = {
  title: "Pages/Activity",
  component: AuditPage,
  parameters: { layout: "fullscreen", location: "/audit" },
  render: () => (
    <AppShell>
      <AuditPage />
    </AppShell>
  ),
} satisfies Meta<typeof AuditPage>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
