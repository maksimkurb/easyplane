import type { Meta, StoryObj } from "@storybook/react-vite"

import {
  AccessSubnets,
  AccessTagsGroups,
  AccessTools,
} from "@/components/access/access-accordions"
import {
  accessRules,
  accessSubjects,
  policyVersions,
} from "../../../.storybook/fixtures/access"
import { users } from "../../../.storybook/fixtures/networks"

const refresh = async () => undefined

const meta = {
  title: "Access/AccessAccordions",
  component: AccessSubnets,
  args: { subjects: accessSubjects },
  render: (args) => (
    <div className="max-w-md">
      <AccessSubnets {...args} />
    </div>
  ),
} satisfies Meta<typeof AccessSubnets>

export default meta
type Story = StoryObj<typeof meta>

export const Subnets: Story = {}

export const SubnetsEmpty: Story = {
  args: { subjects: { ...accessSubjects, subnets: [] } },
}

export const TagsAndGroups: Story = {
  render: (args) => (
    <div className="max-w-md">
      <AccessTagsGroups canEdit refresh={refresh} subjects={args.subjects} />
    </div>
  ),
}

export const TagsAndGroupsEmpty: Story = {
  render: () => (
    <div className="max-w-md">
      <AccessTagsGroups
        canEdit={false}
        refresh={refresh}
        subjects={{ ...accessSubjects, tags: [], userGroups: [] }}
      />
    </div>
  ),
}

export const Tools: Story = {
  render: () => (
    <div className="max-w-3xl">
      <AccessTools
        canAdmin
        canTest
        jsonMode={false}
        mode="rules"
        networkId="net-home-lab"
        onHighlightRule={() => undefined}
        onToggleJson={() => undefined}
        refresh={refresh}
        rules={accessRules}
        subjects={accessSubjects}
        users={users}
        versions={policyVersions}
      />
    </div>
  ),
}

export const ToolsNoHistory: Story = {
  render: () => (
    <AccessTools
      canAdmin={false}
      canTest={false}
      jsonMode={false}
      mode="rules"
      networkId="net-home-lab"
      onHighlightRule={() => undefined}
      onToggleJson={() => undefined}
      refresh={refresh}
      rules={[]}
      subjects={accessSubjects}
      users={users}
      versions={[]}
    />
  ),
}

