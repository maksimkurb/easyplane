import type { Meta, StoryObj } from "@storybook/react-vite"

import { RuleRow } from "@/components/access/rule-row"
import { accessRules, accessSubjects } from "../../../.storybook/fixtures/access"

const noop = () => undefined

const meta = {
  title: "Access/RuleRow",
  component: RuleRow,
  args: {
    rule: accessRules[1]!,
    index: 1,
    subjects: accessSubjects,
    canEdit: true,
    busy: false,
    highlighted: false,
    canMoveUp: true,
    canMoveDown: true,
    onOpen: noop,
    onToggle: noop,
    onDuplicate: noop,
    onDelete: noop,
    onMove: noop,
    onDragStart: noop,
    onDrop: noop,
  },
  render: (args) => (
    <div className="max-w-4xl divide-y divide-line rounded-xl bg-card ring-1 ring-line">
      <RuleRow {...args} />
    </div>
  ),
} satisfies Meta<typeof RuleRow>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const DisabledRule: Story = { args: { rule: accessRules[4]!, index: 4 } }

export const Highlighted: Story = { args: { highlighted: true } }

export const WithError: Story = { args: { error: "Port 99999 is out of range" } }

export const ReadOnly: Story = { args: { canEdit: false } }

export const LongSubjects: Story = {
  args: { rule: accessRules[3]!, index: 3 },
}

export const FirstRow: Story = { args: { canMoveUp: false } }
