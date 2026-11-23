import type { Meta, StoryObj } from "@storybook/react-vite"
import {
  BanIcon,
  ExternalLinkIcon,
  MoreHorizontalIcon,
  PencilIcon,
  TagIcon,
  Trash2Icon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

const meta = {
  title: "UI/DropdownMenu",
  component: DropdownMenu,
  parameters: { layout: "centered" },
  render: () => (
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger
        render={<Button aria-label="Device actions" size="icon-sm" variant="ghost" />}
      >
        <MoreHorizontalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem>
          <ExternalLinkIcon />
          Open device
        </DropdownMenuItem>
        <DropdownMenuItem>
          <PencilIcon />
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem>
          <TagIcon />
          Edit tags
        </DropdownMenuItem>
        <DropdownMenuCheckboxItem checked>Hub mode</DropdownMenuCheckboxItem>
        <DropdownMenuItem>
          <BanIcon />
          Block
        </DropdownMenuItem>
        <DropdownMenuItem destructive>
          <Trash2Icon />
          Remove
        </DropdownMenuItem>
        <DropdownMenuItem disabled>
          <BanIcon />
          Push configuration (offline)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
} satisfies Meta<typeof DropdownMenu>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
