import type { Meta, StoryObj } from "@storybook/react-vite"

import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const rows = [
  { hostname: "nas-01", ip: "10.42.0.11", state: "Online", os: "Debian 12" },
  { hostname: "macbook-pro", ip: "10.42.0.12", state: "Online", os: "macOS 15.1" },
  {
    hostname: "a-very-long-hostname-that-keeps-going-beyond-any-reasonable-table-cell-width",
    ip: "172.20.0.13",
    state: "Offline",
    os: "Debian 9",
  },
]

const meta = {
  title: "UI/Table",
  component: Table,
  render: (args) => (
    <Table {...args} containerClassName="max-w-2xl">
      <TableCaption>Devices in the current network.</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Hostname</TableHead>
          <TableHead>Virtual IP</TableHead>
          <TableHead>State</TableHead>
          <TableHead>OS</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.hostname}>
            <TableCell className="max-w-52 truncate font-medium">{row.hostname}</TableCell>
            <TableCell className="font-mono text-xs">{row.ip}</TableCell>
            <TableCell>
              <Badge variant={row.state === "Online" ? "success" : "secondary"}>
                {row.state}
              </Badge>
            </TableCell>
            <TableCell>{row.os}</TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell colSpan={4}>3 devices</TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  ),
} satisfies Meta<typeof Table>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Empty: Story = {
  render: (args) => (
    <Table {...args}>
      <TableHeader>
        <TableRow>
          <TableHead>Hostname</TableHead>
          <TableHead>Virtual IP</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell className="text-fg-3" colSpan={2}>
            No devices match the filter.
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  ),
}
