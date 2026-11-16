import { describe, expect, it } from "vitest"
import { screen } from "@testing-library/react"

import i18n from "@/i18n"
import {
  DeviceRoleBadge,
  NetworkAccessCard,
} from "@/components/network-access-card"
import { renderWithProviders } from "./test-utils"

const NETWORK = {
  id: "8a2f1b0e-0000-4000-8000-000000000010",
  useRendezvous: true,
  access: {
    mode: "credentials" as const,
    anchors: 1,
    onlineAnchors: 0,
    members: 3,
    activeCredentials: 3,
    expiringCredentials: 0,
    warnings: ["no_anchor_online", "only_one_anchor"] as const,
  },
}

describe("network access card", () => {
  it("shows the mode, counts, warnings and the comparison table", async () => {
    await i18n.changeLanguage("en")
    renderWithProviders(<NetworkAccessCard network={NETWORK} />)
    expect(screen.getByText("Device authentication")).toBeInTheDocument()
    expect(screen.getAllByText("Per-device credentials").length).toBeGreaterThan(0)
    expect(screen.getByText(/Anchors online: 0 of 1/)).toBeInTheDocument()
    expect(screen.getByText(/No anchor is online/)).toBeInTheDocument()
    expect(screen.getByText(/Only one anchor/)).toBeInTheDocument()
    expect(screen.getByText("Removing a device")).toBeInTheDocument()
  })

  it("renders the same card in Russian", async () => {
    await i18n.changeLanguage("ru")
    renderWithProviders(<NetworkAccessCard network={NETWORK} />)
    expect(screen.getByText("Аутентификация устройств")).toBeInTheDocument()
    expect(screen.getByText(/Anchor-ов онлайн: 0 из 1/)).toBeInTheDocument()
    expect(screen.getByText(/Ни один anchor не онлайн/)).toBeInTheDocument()
    await i18n.changeLanguage("en")
  })

  it("does not render anchor warnings in shared-secret mode", async () => {
    await i18n.changeLanguage("en")
    renderWithProviders(
      <NetworkAccessCard
        network={{
          ...NETWORK,
          access: {
            mode: "shared_secret",
            anchors: 2,
            onlineAnchors: 2,
            members: 0,
            activeCredentials: 0,
            expiringCredentials: 0,
            warnings: [],
          },
        }}
      />,
    )
    expect(screen.getAllByText("Shared secret").length).toBeGreaterThan(0)
    expect(screen.queryByText(/No anchor is online/)).not.toBeInTheDocument()
  })
})

describe("device role badge", () => {
  it("labels an anchor as a secret holder and a member with its expiry", async () => {
    await i18n.changeLanguage("en")
    renderWithProviders(
      <div>
        <DeviceRoleBadge role="anchor" />
        <DeviceRoleBadge
          expiresAt="2026-06-01T00:00:00.000Z"
          role="member"
          status="active"
        />
      </div>,
    )
    expect(screen.getByText("Anchor")).toBeInTheDocument()
    expect(screen.getByText("Member")).toBeInTheDocument()
  })
})
