import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"

import {
  SettingsCard,
  SettingsRow,
  SwitchRowBody,
  UnsavedChangesBar,
} from "@/components/network/settings-layout"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

function SettingsDemo() {
  const [enabled, setEnabled] = useState(true)
  return (
    <div className="max-w-2xl space-y-4">
      <SettingsCard
        description="Where the panel is reachable and how it introduces devices."
        title="General"
      >
        <SettingsRow description="Shown to every member." htmlFor="settings-name" label="Display name">
          <Input defaultValue="home-lab" id="settings-name" />
        </SettingsRow>
        <SettingsRow label="MagicDNS" description="Resolve devices by name inside the mesh.">
          <SwitchRowBody
            checked={enabled}
            label="MagicDNS"
            offLabel="Disabled"
            onCheckedChange={setEnabled}
            onLabel="Enabled"
          />
        </SettingsRow>
        <SettingsRow label="Export" description="Download the generated TOML.">
          <Button size="sm" variant="outline">
            Download
          </Button>
        </SettingsRow>
      </SettingsCard>
      <UnsavedChangesBar
        onDiscard={() => undefined}
        onSave={() => undefined}
        show
      />
    </div>
  )
}

const meta = {
  title: "Network/SettingsLayout",
  component: SettingsCard,
  render: () => <SettingsDemo />,
} satisfies Meta<typeof SettingsCard>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Danger: Story = {
  render: () => (
    <div className="max-w-2xl">
      <SettingsCard
        description="These actions cannot be undone."
        title="Danger zone"
        tone="danger"
      >
        <SettingsRow label="Delete network" description="Remove every device and route.">
          <Button size="sm" variant="destructive">
            Delete
          </Button>
        </SettingsRow>
      </SettingsCard>
    </div>
  ),
}

export const Saving: Story = {
  render: () => (
    <div className="max-w-2xl">
      <UnsavedChangesBar
        onDiscard={() => undefined}
        onSave={() => undefined}
        saving
        show
      />
    </div>
  ),
}
