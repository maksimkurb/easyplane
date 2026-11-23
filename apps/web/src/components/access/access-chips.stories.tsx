import type { Meta, StoryObj } from "@storybook/react-vite"

import {
  AllowDenyPill,
  GroupChip,
  PlainDeviceChip,
  SubjectChipView,
  SubjectChips,
  TagChip,
} from "@/components/access/access-chips"
import type { SubjectChip } from "@/lib/access-policy"
import { accessSubjects } from "../../../.storybook/fixtures/access"

const chips: SubjectChip[] = [
  { subject: "tag:work", kind: "tag", label: "tag:work" },
  { subject: "group:admins", kind: "group", label: "group:admins", detail: "2 people" },
  { subject: "subnet:office", kind: "subnet", label: "subnet:office", detail: "172.20.0.0/16" },
  { subject: "host:nas", kind: "host", label: "host:nas", detail: "192.168.50.10" },
  { subject: "cidr:10.42.0.0/16", kind: "cidr", label: "cidr:10.42.0.0/16" },
  { subject: "device:nas-01", kind: "device", label: "device:nas-01" },
  { subject: "unknown:thing", kind: "unknown", label: "unknown:thing" },
  { subject: "*", kind: "any", label: "anyone" },
]

const meta = {
  title: "Access/AccessChips",
  component: SubjectChipView,
  args: { chip: chips[0]! },
  render: (args) => (
    <div className="flex flex-wrap items-center gap-2">
      {chips.map((chip) => (
        <SubjectChipView {...args} chip={chip} key={chip.subject} />
      ))}
    </div>
  ),
} satisfies Meta<typeof SubjectChipView>

export default meta
type Story = StoryObj<typeof meta>

export const AllSubjectKinds: Story = {}

export const AllowDeny: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <AllowDenyPill action="allow" />
      <AllowDenyPill action="deny" />
    </div>
  ),
}

export const TagAndGroup: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <TagChip name="tag:storage" />
      <GroupChip name="group:design" />
      <PlainDeviceChip name="nas-01" />
    </div>
  ),
}

export const LongNames: Story = {
  render: () => (
    <div className="max-w-sm space-y-2">
      <TagChip name="tag:an-extremely-long-tag-name-that-would-overflow-a-row" />
      <GroupChip name="group:a-whole-department-with-a-long-name" />
      <PlainDeviceChip name="a-very-long-hostname-that-keeps-going-beyond-any-reasonable-cell-width-01" />
    </div>
  ),
}

export const SubjectSelection: Story = {
  render: () => (
    <div className="max-w-xl space-y-3">
      <SubjectChips
        side="from"
        subjects={accessSubjects}
        values={["tag:work", "group:admins", "*"]}
      />
      <SubjectChips
        side="to"
        subjects={accessSubjects}
        values={[
          "cidr:10.42.1.0/24",
          "cidr:10.42.2.0/24",
          "subnet:office",
          "host:nas",
          "tag:storage",
        ]}
      />
    </div>
  ),
}
