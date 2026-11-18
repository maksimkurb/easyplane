import { afterEach, describe, expect, it, vi } from "vitest"
import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import type { GetNetwork200, ListDevices200Item } from "@/api/generated/model"
import { SetupChecklist } from "@/components/network/setup-checklist"
import { renderWithProviders } from "./test-utils"

const NETWORK = {
  id: "8a2f1b0e-0000-4000-8000-000000000010",
  name: "Home lab",
  networkName: "homelab-7f3a91",
  ipv4Cidr: "10.144.144.0/24",
  magicDnsEnabled: false,
  magicDnsZone: "et.net",
  policyVersion: 0,
  policyMode: "open",
  useRendezvous: false,
  p2pOnly: false,
  deviceCounts: { approved: 0, pending: 0, blocked: 0 },
} as unknown as GetNetwork200

function device(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    networkId: NETWORK.id,
    state: "approved",
    online: "online",
    hostname: id,
    dnsName: id,
    machineId: id,
    advertisedEndpoints: [],
    isHub: false,
    ...overrides,
  } as unknown as ListDevices200Item
}

describe("SetupChecklist", () => {
  afterEach(() => {
    window.localStorage.clear()
  })

  it("shows the guided path with one action per step", async () => {
    const openAddDevice = vi.fn()
    renderWithProviders(
      <SetupChecklist
        devices={[]}
        network={NETWORK}
        openAddDevice={openAddDevice}
      />
    )

    expect(screen.getByText("Set up your network")).toBeInTheDocument()
    expect(screen.getByText("0 of 5 done")).toBeInTheDocument()
    expect(screen.getByText(/Add your first device/)).toBeInTheDocument()
    expect(
      screen.getByText(/Make a device reachable from the internet/)
    ).toBeInTheDocument()

    await userEvent
      .setup()
      .click(screen.getAllByRole("button", { name: "Add device" })[0]!)
    expect(openAddDevice).toHaveBeenCalled()
  })

  it("switches to optional steps once the required path is done", () => {
    renderWithProviders(
      <SetupChecklist
        devices={[device("laptop"), device("server")]}
        network={NETWORK}
        openAddDevice={() => undefined}
      />
    )

    expect(screen.getByText("Optional next steps")).toBeInTheDocument()
    expect(screen.queryByText(/Add your first device/)).not.toBeInTheDocument()
    expect(screen.getByText(/Make a device reachable/)).toBeInTheDocument()
    expect(screen.getByText(/Set up access rules/)).toBeInTheDocument()
  })

  it("disappears on its own when every step is done", () => {
    renderWithProviders(
      <SetupChecklist
        devices={[device("laptop", { isHub: true }), device("server")]}
        network={{ ...NETWORK, policyVersion: 2, policyMode: "rules" }}
        openAddDevice={() => undefined}
      />
    )

    expect(screen.queryByText("Set up your network")).not.toBeInTheDocument()
    expect(screen.queryByText("Optional next steps")).not.toBeInTheDocument()
  })

  it("remembers a dismissal per network", async () => {
    const user = userEvent.setup()
    const { unmount } = renderWithProviders(
      <SetupChecklist
        devices={[]}
        network={NETWORK}
        openAddDevice={() => undefined}
      />
    )

    await user.click(
      screen.getByRole("button", { name: "Dismiss setup checklist" })
    )
    expect(screen.queryByText("Set up your network")).not.toBeInTheDocument()
    unmount()

    renderWithProviders(
      <SetupChecklist
        devices={[]}
        network={NETWORK}
        openAddDevice={() => undefined}
      />
    )
    expect(screen.queryByText("Set up your network")).not.toBeInTheDocument()
  })
})
