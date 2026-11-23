import type { Meta, StoryObj } from "@storybook/react-vite"

import { AccessRules } from "@/components/access/access-rules"
import type { AccessRule } from "@/lib/access-policy"
import {
  accessChains,
  accessRules,
  accessSubjects,
} from "../../../.storybook/fixtures/access"

const noop = () => undefined

const meta = {
  title: "Access/AccessRules",
  component: AccessRules,
  args: {
    rules: accessRules,
    subjects: accessSubjects,
    networkId: "net-home-lab",
    chains: accessChains,
    canEdit: true,
    busy: false,
    errors: {},
    highlightIndex: null,
    enforced: true,
    onChangeRule: noop,
    onSaveRule: noop,
    onDeleteRule: noop,
    onUndoDelete: noop,
    onMoveRule: noop,
    onReorderRule: noop,
    onDuplicateRule: noop,
    onCreateRule: noop,
    onChangeChain: noop,
  },
  render: (args) => (
    <div className="max-w-4xl">
      <AccessRules {...args} />
    </div>
  ),
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof AccessRules>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Empty: Story = { args: { rules: [] } }

export const WithErrors: Story = {
  args: { errors: { 1: { ports: "Port 99999 is out of range" }, 2: { to: "Choose at least one destination" } } },
}

export const Highlighted: Story = { args: { highlightIndex: 3 } }

export const ReadOnly: Story = { args: { canEdit: false } }

export const Busy: Story = { args: { busy: true } }

export const NotEnforced: Story = { args: { enforced: false } }

export const LongCidrs: Story = {
  args: {
    rules: [
      {
        name: "Every internal subnet from the long list",
        enabled: true,
        action: "allow",
        from: ["tag:infra"],
        to: [
          "cidr:10.42.1.0/24",
          "cidr:10.42.2.0/24",
          "cidr:10.42.3.0/24",
          "cidr:10.42.4.0/24",
          "cidr:10.42.5.0/24",
          "cidr:10.42.6.0/24",
          "cidr:2001:db8:3333:4444:5555:6666:7777:8888/128",
          "subnet:office",
          "subnet:iot",
          "host:nas",
          "host:printer",
          "group:design",
          "group:admins",
          "tag:storage",
          "device:nas-01",
          "device:edge-router",
          "device:rpi-sensor",
        ],
        protocol: "tcp",
        ports: ["443", "8080", "8443", "9418", "3000", "5000"],
        sourcePorts: ["1024-65535"],
        stateful: true,
      } satisfies AccessRule,
    ],
  },
}

export const SingleRule: Story = { args: { rules: accessRules.slice(0, 1) } }
