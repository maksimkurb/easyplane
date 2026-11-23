import type { Meta, StoryObj } from "@storybook/react-vite"

import { Button } from "@/components/ui/button"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldHint,
  FieldLabel,
  FieldSeparator,
  FieldTitle,
} from "@/components/shared/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"

const meta = {
  title: "Shared/Field",
  component: Field,
  render: (args) => (
    <FieldGroup className="w-96 max-w-full">
      <Field {...args}>
        <FieldLabel htmlFor="field-name">Network name</FieldLabel>
        <FieldContent>
          <Input defaultValue="easytier-home-lab" id="field-name" />
          <FieldDescription>
            Shown to every client; changing it renames the mesh.
          </FieldDescription>
        </FieldContent>
      </Field>
      <FieldSeparator />
      <Field orientation="horizontal">
        <FieldContent>
          <FieldTitle>MagicDNS</FieldTitle>
          <FieldDescription>
            Give devices names like nas-01.home.easytier.
          </FieldDescription>
        </FieldContent>
        <Switch aria-label="MagicDNS" defaultChecked />
      </Field>
    </FieldGroup>
  ),
} satisfies Meta<typeof Field>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Invalid: Story = {
  render: (args) => (
    <FieldGroup className="w-96 max-w-full">
      <Field {...args} invalid>
        <FieldLabel htmlFor="field-cidr">IPv4 CIDR</FieldLabel>
        <FieldContent>
          <Input aria-invalid defaultValue="10.42.0.0/33" id="field-cidr" />
          <FieldHint error="Prefix length must be between 0 and 32." />
        </FieldContent>
      </Field>
    </FieldGroup>
  ),
}

export const Horizontal: Story = {
  render: () => (
    <Field className="max-w-md" orientation="horizontal">
      <FieldContent>
        <FieldTitle>Relay data</FieldTitle>
        <FieldDescription>Allow traffic through public relays.</FieldDescription>
      </FieldContent>
      <Switch aria-label="Relay data" />
    </Field>
  ),
}

export const Errors: Story = {
  render: () => (
    <FieldError
      errors={[
        { message: "Name is required." },
        { message: "Name must be unique in this network." },
      ]}
    />
  ),
}

export const WithButton: Story = {
  render: () => (
    <Field className="max-w-md" orientation="horizontal">
      <FieldContent>
        <FieldTitle>Rotate secret</FieldTitle>
      </FieldContent>
      <Button size="sm" variant="outline">
        Rotate
      </Button>
    </Field>
  ),
}
