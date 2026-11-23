import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"

import { SubjectPicker } from "@/components/access/subject-picker"
import { accessSubjects } from "../../../.storybook/fixtures/access"

function SubjectPickerDemo({
  side,
  initial,
  disabled,
  error,
}: {
  side: "from" | "to"
  initial: string[]
  disabled?: boolean
  error?: string
}) {
  const [values, setValues] = useState(initial)
  return (
    <div className="w-96 max-w-full">
      <SubjectPicker
        disabled={disabled}
        error={error}
        label={side === "from" ? "From" : "To"}
        onChange={setValues}
        side={side}
        subjects={accessSubjects}
        values={values}
      />
    </div>
  )
}

const meta = {
  title: "Access/SubjectPicker",
  component: SubjectPicker,
  args: {
    subjects: accessSubjects,
    side: "from",
    label: "From",
    values: ["tag:work"],
    onChange: () => undefined,
  },
  render: (args) => <SubjectPickerDemo initial={args.values} side={args.side} />,
} satisfies Meta<typeof SubjectPicker>

export default meta
type Story = StoryObj<typeof meta>

export const From: Story = {}

export const To: Story = {
  args: { side: "to", values: ["cidr:10.42.1.0/24", "subnet:office"] },
}

export const Empty: Story = { args: { values: [] } }

export const Disabled: Story = {
  render: () => <SubjectPickerDemo disabled initial={["tag:work"]} side="from" />,
}

export const WithError: Story = {
  render: () => (
    <SubjectPickerDemo error="Choose at least one source" initial={[]} side="from" />
  ),
}
