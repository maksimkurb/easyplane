import type { Meta, StoryObj } from "@storybook/react-vite"

import { AccessMatrix } from "@/components/access/access-matrix"
import { accessChains, accessRules, accessSubjects } from "../../../.storybook/fixtures/access"

const meta = {
  title: "Access/AccessMatrix",
  component: AccessMatrix,
  args: {
    subjects: accessSubjects,
    rules: accessRules,
    chains: accessChains,
    enforced: true,
  },
  render: (args) => (
    <div className="max-w-4xl">
      <AccessMatrix {...args} />
    </div>
  ),
} satisfies Meta<typeof AccessMatrix>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const NotEnforced: Story = { args: { enforced: false } }

export const NoGroups: Story = {
  args: { subjects: { ...accessSubjects, userGroups: [] } },
}

export const NoTags: Story = {
  args: { subjects: { ...accessSubjects, tags: [] } },
}
