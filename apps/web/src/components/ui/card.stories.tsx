import type { Meta, StoryObj } from "@storybook/react-vite"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

const meta = {
  title: "UI/Card",
  component: Card,
  args: { size: "default" },
  argTypes: { size: { control: "select", options: ["default", "sm"] } },
  render: (args) => (
    <Card {...args} className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Rendezvous</CardTitle>
        <CardDescription>
          Public relays that introduce peers that cannot reach each other
          directly.
        </CardDescription>
        <CardAction>
          <Button size="sm" variant="outline">
            Configure
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <p>
          Two endpoints are configured. Relay data is enabled, so traffic can
          fall back to the relay when a direct path is impossible.
        </p>
      </CardContent>
      <CardFooter>
        <Button size="sm" variant="ghost">
          View logs
        </Button>
      </CardFooter>
    </Card>
  ),
} satisfies Meta<typeof Card>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Small: Story = { args: { size: "sm" } }

export const ContentOnly: Story = {
  render: (args) => (
    <Card {...args} className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Quick facts</CardTitle>
      </CardHeader>
      <CardContent className="text-[13px] text-fg-2">
        9 devices · 7 online · 2 anchors
      </CardContent>
    </Card>
  ),
}

export const LongText: Story = {
  render: (args) => (
    <Card {...args} className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>
          A card title that is long enough to wrap onto a second line at phone
          width
        </CardTitle>
        <CardDescription>
          Descriptions wrap too, because policy explanations can be a paragraph
          rather than a sentence.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="break-words">
          network_name = "easytier-home-lab-with-an-extraordinarily-long-name"
        </p>
      </CardContent>
    </Card>
  ),
}
