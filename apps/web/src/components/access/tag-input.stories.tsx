import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"

import { TagInput } from "@/components/access/tag-input"

function TagInputDemo({
  initial,
  disabled,
  invalid,
  numeric,
}: {
  initial: string[]
  disabled?: boolean
  invalid?: boolean
  numeric?: boolean
}) {
  const [values, setValues] = useState(initial)
  return (
    <div className="w-96 max-w-full">
      <TagInput
        disabled={disabled}
        inputMode={numeric ? "numeric" : "text"}
        invalid={invalid}
        isRange={(value) => value.includes("-")}
        label={numeric ? "Ports" : "Tags"}
        onChange={setValues}
        placeholder={numeric ? "443" : "tag:work"}
        validate={(value) =>
          numeric && !/^\d{1,5}(-\d{1,5})?$/.test(value)
            ? "Use a port or a range like 8000-8100"
            : value.includes(" ")
              ? "No spaces"
              : null
        }
        values={values}
      />
    </div>
  )
}

const meta = {
  title: "Access/TagInput",
  component: TagInput,
  args: {
    values: ["tag:work", "tag:storage"],
    label: "Tags",
    onChange: () => undefined,
    validate: () => null,
    placeholder: "tag:work",
  },
  render: (args) => (
    <div className="w-96 max-w-full">
      <TagInput {...args} />
    </div>
  ),
} satisfies Meta<typeof TagInput>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { render: () => <TagInputDemo initial={["tag:work", "tag:storage"]} /> }

export const Empty: Story = { render: () => <TagInputDemo initial={[]} /> }

export const Disabled: Story = {
  render: () => <TagInputDemo disabled initial={["tag:work"]} />,
}

export const Invalid: Story = {
  render: () => <TagInputDemo initial={["tag:work", "tag:with space"]} invalid />,
}

export const Ports: Story = {
  render: () => <TagInputDemo initial={["443", "8000-8100"]} numeric />,
}
