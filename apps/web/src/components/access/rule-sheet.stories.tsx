import type { Meta, StoryObj } from "@storybook/react-vite"

import { RuleSheet } from "@/components/access/rule-sheet"
import { accessRules, accessSubjects } from "../../../.storybook/fixtures/access"

const meta = {
  title: "Access/RuleSheet",
  component: RuleSheet,
  args: {
    open: true,
    onOpenChange: () => undefined,
    rule: accessRules[1]!,
    index: 1,
    subjects: accessSubjects,
    networkId: "net-home-lab",
    canEdit: true,
    busy: false,
    errors: {},
    onSave: () => undefined,
  },
  parameters: { layout: "centered" },
} satisfies Meta<typeof RuleSheet>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const NewRule: Story = { args: { index: null } }

export const WithErrors: Story = {
  args: { errors: { ports: "Port 99999 is out of range", to: "Choose a destination" } },
}

export const ReadOnly: Story = { args: { canEdit: false } }

export const LongRule: Story = { args: { rule: accessRules[3]!, index: 3 } }
