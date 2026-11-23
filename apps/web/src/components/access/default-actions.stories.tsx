import type { Meta, StoryObj } from "@storybook/react-vite"

import {
  ChainDefaultsForm,
  ChainDirectionLabel,
  DefaultActionsPanel,
  DefaultActionsRow,
} from "@/components/access/default-actions"
import { accessChains } from "../../../.storybook/fixtures/access"

const meta = {
  title: "Access/DefaultActions",
  component: DefaultActionsRow,
  args: { chains: accessChains, onChange: () => undefined },
  render: (args) => (
    <div className="max-w-3xl">
      <DefaultActionsRow {...args} />
    </div>
  ),
} satisfies Meta<typeof DefaultActionsRow>

export default meta
type Story = StoryObj<typeof meta>

export const Row: Story = {}

export const RowReadOnly: Story = { args: { disabled: true } }

export const ChainForm: Story = {
  render: (args) => (
    <div className="max-w-3xl">
      <ChainDefaultsForm {...args} />
    </div>
  ),
}

export const DirectionLabels: Story = {
  render: () => (
    <div className="flex flex-col gap-2">
      <ChainDirectionLabel name="inbound" />
      <ChainDirectionLabel name="outbound" />
      <ChainDirectionLabel name="forward" />
    </div>
  ),
}

export const Panel: Story = {
  render: (args) => (
    <div className="max-w-4xl">
      <DefaultActionsPanel
        chains={args.chains}
        onChange={() => undefined}
      />
    </div>
  ),
}
