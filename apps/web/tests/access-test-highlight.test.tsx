import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"

import "@/i18n"
import { AccessRules } from "@/components/access/access-rules"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ruleIndexForCompiledName } from "@/components/access/access-rule-summary"
import { DOCUMENT, NETWORK_ID, SUBJECTS } from "./access-fixtures"

const RULES = DOCUMENT.rules

function renderRules(highlightIndex: number | null) {
  return render(
    <TooltipProvider>
      <AccessRules
        busy={false}
        canEdit
        chains={DOCUMENT.chains}
        errors={{}}
        highlightIndex={highlightIndex}
        networkId={NETWORK_ID}
        onChangeChain={vi.fn()}
        onChangeRule={vi.fn()}
        onCreateRule={vi.fn()}
        onDeleteRule={vi.fn()}
        onDuplicateRule={vi.fn()}
        onMoveRule={vi.fn()}
        onReorderRule={vi.fn()}
        onSaveRule={vi.fn()}
        onUndoDelete={vi.fn()}
        rules={RULES}
        subjects={SUBJECTS}
      />
    </TooltipProvider>
  )
}

describe("test-access highlighting", () => {
  it("maps a compiled rule name back to its document rule", () => {
    expect(ruleIndexForCompiledName(RULES, "Block SSH to NAS-in")).toBe(0)
    expect(ruleIndexForCompiledName(RULES, "LAN to VPS-reply-out")).toBe(1)
    expect(ruleIndexForCompiledName(RULES, null)).toBeNull()
    expect(ruleIndexForCompiledName(RULES, "unknown-rule-in")).toBeNull()
  })

  it("marks the row a reachability test decided by", () => {
    renderRules(1)
    expect(screen.getByTestId("rule-row-1")).toHaveAttribute(
      "data-highlighted",
      "true"
    )
    expect(screen.getByTestId("rule-row-0")).not.toHaveAttribute(
      "data-highlighted"
    )
  })

  it("orders the list and shows the default-action row at the end", () => {
    renderRules(null)
    expect(
      screen.getByText(/Rules are checked top to bottom/)
    ).toBeInTheDocument()
    expect(screen.getByText(/^Everything else:/)).toBeInTheDocument()
    const rows = screen.getAllByTestId(/^rule-row-/)
    expect(rows[0]).toHaveTextContent("Block SSH to NAS")
    expect(rows[1]).toHaveTextContent("LAN to VPS")
  })
})
