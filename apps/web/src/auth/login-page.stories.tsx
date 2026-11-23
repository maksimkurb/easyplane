import type { Meta, StoryObj } from "@storybook/react-vite"

import { LoginPage } from "@/auth/login-page"

const meta = {
  title: "Pages/Login",
  component: LoginPage,
  parameters: { layout: "fullscreen", location: "/login" },
} satisfies Meta<typeof LoginPage>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
