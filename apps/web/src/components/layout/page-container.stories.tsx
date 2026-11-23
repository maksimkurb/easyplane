import type { Meta, StoryObj } from "@storybook/react-vite"

import { PageContainer } from "@/components/layout/page-container"

const meta = {
  title: "Layout/PageContainer",
  component: PageContainer,
  parameters: { layout: "fullscreen" },
  render: (args) => (
    <PageContainer {...args} className="bg-surface-2 py-6">
      <div className="rounded-xl bg-card p-4 ring-1 ring-line">
        The 1180px content column: 16px gutters on phones, 24px on tablets and
        32px on desktop.
      </div>
    </PageContainer>
  ),
} satisfies Meta<typeof PageContainer>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
