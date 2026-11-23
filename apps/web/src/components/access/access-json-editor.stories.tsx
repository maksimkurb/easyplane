import type { Meta, StoryObj } from "@storybook/react-vite"

import { AccessJsonEditor } from "@/components/access/access-json-editor"
import { emptyAccessDocument } from "@/lib/access-policy"
import { accessChains, accessRules } from "../../../.storybook/fixtures/access"

const document = {
  ...emptyAccessDocument("json"),
  chains: accessChains,
  rules: accessRules,
  tags: {
    "tag:work": ["dev-macbook-pro", "dev-arch-devbox"],
    "tag:storage": ["dev-nas-01", "dev-office-nas"],
  },
  subnets: {
    "subnet:office": { cidr: "172.20.0.0/16", via: "freebsd-fw" },
  },
}

const meta = {
  title: "Access/AccessJsonEditor",
  component: AccessJsonEditor,
  args: {
    networkId: "net-home-lab",
    document,
    canEdit: true,
    onSaved: () => undefined,
  },
  render: (args) => (
    <div className="max-w-3xl">
      <AccessJsonEditor {...args} />
    </div>
  ),
} satisfies Meta<typeof AccessJsonEditor>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const ReadOnly: Story = { args: { canEdit: false } }
