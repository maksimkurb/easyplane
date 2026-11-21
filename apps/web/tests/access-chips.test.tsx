import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"

import "@/i18n"
import { SubjectChips } from "@/components/access/access-chips"
import type { GetPolicySubjects200 } from "@/api/generated/model"
import { SUBJECTS } from "./access-fixtures"

describe("SubjectChips", () => {
  it("keeps an address in one line instead of breaking it mid-CIDR", () => {
    render(
      <SubjectChips
        side="to"
        subjects={SUBJECTS}
        values={["cidr:192.168.42.0/24"]}
      />
    )
    expect(screen.getByText("192.168.42.0/24")).toHaveClass("whitespace-nowrap")
  })

  it("shows an auto subnet as an address and its exit device", () => {
    const subjects: GetPolicySubjects200 = {
      ...SUBJECTS,
      subnets: [
        {
          id: "auto",
          name: "owrt-h1-192-168-40-0-23",
          display: "192.168.40.0/23 via owrt-h1",
          cidr: "192.168.40.0/23",
          viaDeviceId: "d-router",
          viaHostname: "owrt-h1",
          routeId: "r2",
          approved: true,
        },
      ],
    }
    render(
      <SubjectChips
        side="to"
        subjects={subjects}
        values={["subnet:owrt-h1-192-168-40-0-23"]}
      />
    )
    expect(screen.getByText("192.168.40.0/23")).toBeInTheDocument()
    expect(screen.getByText("via owrt-h1")).toBeInTheDocument()
    expect(
      screen.queryByText("owrt-h1-192-168-40-0-23")
    ).not.toBeInTheDocument()
  })
})
