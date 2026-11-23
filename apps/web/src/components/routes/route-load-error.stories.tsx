import type { Meta, StoryObj } from "@storybook/react-vite"

import { RouteLoadError } from "@/components/routes/route-load-error"

const meta = {
  title: "Routes/RouteLoadError",
  component: RouteLoadError,
  args: { onRetry: () => undefined, pending: false },
  render: (args) => (
    <div className="max-w-2xl">
      <RouteLoadError {...args} />
    </div>
  ),
} satisfies Meta<typeof RouteLoadError>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Pending: Story = { args: { pending: true } }

export const CustomMessage: Story = {
  args: { message: "Route reports are unavailable for this network." },
}

export const LongMessage: Story = {
  args: {
    message:
      "Couldn't load routes because the server returned a 502 while the topology collector was restarting. The device list below is still up to date.",
  },
}
