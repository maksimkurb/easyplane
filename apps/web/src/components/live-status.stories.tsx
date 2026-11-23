import type { Meta, StoryObj } from "@storybook/react-vite"

import { LiveStatus } from "@/components/live-status"
import { RealtimeContext } from "@/realtime/context"
import type { RealtimeStatus } from "@/realtime/use-event-stream"

const meta = {
  title: "Components/LiveStatus",
  component: LiveStatus,
  parameters: { layout: "centered" },
  render: (args) => (
    <RealtimeContext.Provider value={{ status: "live", lastSeq: 128 }}>
      <LiveStatus {...args} />
    </RealtimeContext.Provider>
  ),
} satisfies Meta<typeof LiveStatus>

export default meta
type Story = StoryObj<typeof meta>

const withStatus = (status: RealtimeStatus) => ({
  render: (args: React.ComponentProps<typeof LiveStatus>) => (
    <RealtimeContext.Provider value={{ status, lastSeq: 128 }}>
      <LiveStatus {...args} />
    </RealtimeContext.Provider>
  ),
})

export const Live: Story = {}

export const Connecting: Story = withStatus("connecting")

export const Reconnecting: Story = withStatus("reconnecting")

export const Offline: Story = withStatus("offline")
