import type { Meta, StoryObj } from "@storybook/react-vite"

import {
  DeviceStatusBadge,
  DeviceStatusBadges,
  DeviceStatusDot,
  InviteStatusBadge,
} from "@/components/device-status"
import { deriveDeviceStatus } from "@/lib/device-status"
import type { ListDevices200Item } from "@/api/generated/model"

const statusFor = (
  input: Pick<
    ListDevices200Item,
    "state" | "online" | "sync" | "lastPushError" | "desiredRevision" | "appliedRevision"
  >
) => deriveDeviceStatus(input)

const online = statusFor({
  state: "approved",
  online: "online",
  sync: "in-sync",
  desiredRevision: 14,
  appliedRevision: 14,
})

const meta = {
  title: "Components/DeviceStatus",
  component: DeviceStatusBadge,
  args: { status: online },
} satisfies Meta<typeof DeviceStatusBadge>

export default meta
type Story = StoryObj<typeof meta>

export const Online: Story = {}

export const EveryStatus: Story = {
  render: () => {
    const cases = [
      ["Online", { state: "approved", online: "online", sync: "in-sync" }],
      ["Updating", { state: "approved", online: "online", sync: "stale", desiredRevision: 15, appliedRevision: 14 }],
      ["Push failed", { state: "approved", online: "online", sync: "error", lastPushError: "Client rejected revision 14" }],
      ["Offline", { state: "approved", online: "offline", sync: "stale", desiredRevision: 15, appliedRevision: 14 }],
      ["Pending", { state: "pending", online: "offline", sync: "not-applicable" }],
      ["Blocked", { state: "blocked", online: "offline", sync: "not-applicable" }],
    ] as const
    return (
      <div className="flex flex-wrap items-center gap-3">
        {cases.map(([label, input]) => (
          <span className="inline-flex items-center gap-2" key={label}>
            <DeviceStatusBadge status={statusFor(input)} />
            <span className="text-xs text-fg-3">{label}</span>
          </span>
        ))}
      </div>
    )
  },
}

export const Dots: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      {(["online", "updating", "push-failed", "offline", "pending", "blocked"] as const).map(
        (kind) => (
          <span className="inline-flex items-center gap-1.5 text-xs" key={kind}>
            <DeviceStatusDot
              status={{
                kind,
                tone: "ok",
                connected: true,
                needsAttention: false,
                pendingRevision: null,
                reason: null,
              }}
            />
            {kind}
          </span>
        )
      )}
    </div>
  ),
}

export const RawDimensions: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <DeviceStatusBadges
        appliedRevision={14}
        desiredRevision={14}
        online="online"
        state="approved"
        sync="in-sync"
      />
      <DeviceStatusBadges
        appliedRevision={14}
        desiredRevision={15}
        online="online"
        state="approved"
        sync="stale"
      />
      <DeviceStatusBadges
        online="offline"
        state="approved"
        sync="stale"
      />
    </div>
  ),
}

export const InviteStatuses: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      {(["active", "expired", "exhausted", "revoked"] as const).map((status) => (
        <InviteStatusBadge key={status} status={status} />
      ))}
    </div>
  ),
}
