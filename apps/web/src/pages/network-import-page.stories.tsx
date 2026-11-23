import type { Meta, StoryObj } from "@storybook/react-vite"

import { AppShell } from "@/components/layout/app-shell"
import { NetworkImportPage } from "@/pages/network-import-page"

const meta = {
  title: "Pages/NetworkImport",
  component: NetworkImportPage,
  parameters: { layout: "fullscreen", location: "/networks/import" },
  render: () => (
    <AppShell>
      <NetworkImportPage />
    </AppShell>
  ),
} satisfies Meta<typeof NetworkImportPage>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
