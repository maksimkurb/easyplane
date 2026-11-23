import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"

import { AdvancedFields } from "@/components/access/advanced-fields"
import { RuleForm, ServiceFields } from "@/components/access/rule-editor"
import type { AccessRule } from "@/lib/access-policy"
import { accessRules, accessSubjects } from "../../../.storybook/fixtures/access"

function RuleFormDemo({
  initial,
  disabled,
  showErrors,
}: {
  initial: AccessRule
  disabled?: boolean
  showErrors?: boolean
}) {
  const [rule, setRule] = useState(initial)
  return (
    <RuleForm
      disabled={disabled}
      index={0}
      networkId="net-home-lab"
      onChange={(patch) => setRule((current) => ({ ...current, ...patch }))}
      rule={rule}
      showErrors={showErrors}
      subjects={accessSubjects}
    />
  )
}

const meta = {
  title: "Access/RuleForm",
  component: RuleForm,
  args: { rule: accessRules[1]!, index: 0, subjects: accessSubjects, networkId: "net-home-lab" },
  render: (args) => (
    <div className="max-w-2xl">
      <RuleFormDemo initial={args.rule} />
    </div>
  ),
} satisfies Meta<typeof RuleForm>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const DenyRule: Story = { args: { rule: accessRules[2]! } }

export const LongDestinations: Story = { args: { rule: accessRules[3]! } }

export const Disabled: Story = {
  render: () => (
    <div className="max-w-2xl">
      <RuleFormDemo disabled initial={accessRules[1]!} />
    </div>
  ),
}

export const WithValidationErrors: Story = {
  render: () => (
    <div className="max-w-2xl">
      <RuleFormDemo initial={accessRules[1]!} showErrors />
    </div>
  ),
}

export const ServicePicker: Story = {
  render: () => <ServicePickerDemo />,
}

function ServicePickerDemo() {
  const [rule, setRule] = useState(accessRules[1]!)
  return (
    <div className="max-w-xl">
      <ServiceFields
        onChange={(patch) => setRule((current) => ({ ...current, ...patch }))}
        rule={rule}
      />
    </div>
  )
}

export const Advanced: Story = {
  render: () => <AdvancedDemo />,
}

function AdvancedDemo() {
  const [rule, setRule] = useState(accessRules[3]!)
  return (
    <div className="max-w-xl">
      <AdvancedFields
        index={3}
        networkId="net-home-lab"
        onChange={(patch) => setRule((current) => ({ ...current, ...patch }))}
        rule={rule}
        subjects={accessSubjects}
      />
    </div>
  )
}
