import type { Meta, StoryObj } from "@storybook/react-vite"

import { AddDeviceDialog } from "@/components/invites/add-device-dialog"
import { AppShell } from "@/components/layout/app-shell"
import { PageContainer } from "@/components/layout/page-container"
import { primaryNetwork } from "../../.storybook/fixtures/networks"

/**
 * There is no standalone invites route: invites are created from the Add
 * device dialog, which is opened from every network tab and from the setup
 * checklist. This story mounts that dialog inside the real shell so the
 * surrounding chrome is reviewed too.
 */
const meta = {
  title: "Pages/Invites",
  component: AddDeviceDialog,
  args: { network: primaryNetwork, open: true, onOpenChange: () => undefined },
  parameters: { layout: "fullscreen", location: "/networks/net-home-lab" },
  render: (args) => (
    <AppShell>
      <PageContainer className="py-8">
        <h1 className="text-2xl font-semibold" id="page-title">
          Add a device
        </h1>
        <p className="mt-1 text-sm text-fg-3">
          Invite dialog opened from the network header.
        </p>
      </PageContainer>
      <AddDeviceDialog {...args} />
    </AppShell>
  ),
} satisfies Meta<typeof AddDeviceDialog>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
