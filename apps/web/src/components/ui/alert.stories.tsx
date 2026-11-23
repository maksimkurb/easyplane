import type { Meta, StoryObj } from "@storybook/react-vite"
import { CircleAlertIcon, TriangleAlertIcon } from "lucide-react"

import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

const meta = {
  title: "UI/Alert",
  component: Alert,
  args: { variant: "default" },
  argTypes: {
    variant: { control: "select", options: ["default", "warning", "destructive"] },
  },
  render: (args) => (
    <Alert {...args}>
      <CircleAlertIcon />
      <AlertTitle>Rendezvous secret differs</AlertTitle>
      <AlertDescription>
        The bundled relay pins a secret that no longer matches this network.
      </AlertDescription>
    </Alert>
  ),
} satisfies Meta<typeof Alert>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Warning: Story = {
  args: { variant: "warning" },
  render: (args) => (
    <Alert {...args}>
      <TriangleAlertIcon />
      <AlertTitle>No anchor is online</AlertTitle>
      <AlertDescription>
        Members cannot reach each other until at least one anchor reconnects.
      </AlertDescription>
    </Alert>
  ),
}

export const Destructive: Story = {
  args: { variant: "destructive" },
  render: (args) => (
    <Alert {...args}>
      <CircleAlertIcon />
      <AlertTitle>Push failed on nas-01</AlertTitle>
      <AlertDescription>
        The client rejected revision 14: unknown configuration option.
      </AlertDescription>
    </Alert>
  ),
}

export const WithAction: Story = {
  args: { variant: "warning" },
  render: (args) => (
    <Alert {...args}>
      <TriangleAlertIcon />
      <AlertTitle>One credential expires tomorrow</AlertTitle>
      <AlertDescription>
        Renew it before the device loses access to the mesh.
      </AlertDescription>
      <AlertAction>
        <Button size="sm" variant="outline">
          Review access
        </Button>
      </AlertAction>
    </Alert>
  ),
}

export const LongText: Story = {
  args: { variant: "default" },
  render: (args) => (
    <Alert {...args}>
      <AlertTitle>What happens when a device goes offline?</AlertTitle>
      <AlertDescription>
        The panel keeps the last configuration and the last reported state. A
        queued revision is pushed as soon as the device reconnects, and the
        status column explains which revision is running instead of scolding the
        device for being unreachable.
      </AlertDescription>
    </Alert>
  ),
}
