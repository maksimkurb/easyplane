import type { Meta, StoryObj } from "@storybook/react-vite"

import { PendingRouteApprovalRow } from "@/components/routes/pending-route-approvals"
import { networkRoutes } from "../../../.storybook/fixtures/network"

const pending = networkRoutes.routes.filter((route) => route.state === "pending")
const subnet = pending.find((route) => route.kind === "subnet")!
const exitNode = pending.find((route) => route.kind === "exit_node")!

const meta = {
  title: "Routes/PendingRouteApprovalRow",
  component: PendingRouteApprovalRow,
  args: { route: subnet, networkId: "net-home-lab" },
  render: (args) => (
    <div className="max-w-3xl divide-y divide-line rounded-xl bg-card ring-1 ring-line">
      <PendingRouteApprovalRow {...args} />
    </div>
  ),
} satisfies Meta<typeof PendingRouteApprovalRow>

export default meta
type Story = StoryObj<typeof meta>

export const Subnet: Story = {}

export const ExitNode: Story = { args: { route: exitNode } }

export const Panel: Story = {
  render: () => (
    <div className="max-w-3xl divide-y divide-line rounded-xl bg-card ring-1 ring-line">
      {pending.map((route) => (
        <PendingRouteApprovalRow
          key={route.id}
          networkId="net-home-lab"
          route={route}
        />
      ))}
    </div>
  ),
}
