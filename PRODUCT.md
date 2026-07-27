# Product

## Users

Solo self-hoster (one user, the owner). Personal use only, not multi-tenant SaaS. Primary context: desktop in the evening for budget review and category adjustments. Secondary context: phone in bed for opportunistic transaction logging when the thought hits. Occasional: Sunday morning at the kitchen table for the weekly pass. Both light and dark themes are first-class because the contexts of use span both.

## Product Purpose

Personal envelope-budgeting and transaction-logging tool, self-hosted via Docker, backed by SimpleFIN for live bank sync. One person managing one or a few budgets. Success looks like a five-second comprehension of "where did I land this month" and one-click logging when a transaction comes to mind.

## Brand Personality

Quiet, candid, considered. Feels like a private notebook with good typography, not a fintech product. Honest about money without dramatizing it. Confident at the brand layer (the sidebar carries identity), restrained on the page (the data does the work).

## Anti-references

- Quickbooks, Excel, and other spreadsheet software. Tabbed gray ribbons, dense forms, no breathing room, ninety-style utilitarian chrome.
- Notion and Linear. Pure white surfaces, faint borders on every container, identical rounded cards, the AI-productivity-tool default.
- YNAB, Mint, Copilot, and other default-finance dashboards. Saturated green on zinc, big number heroes, identical card grids. The first-order finance reflex.
- Robinhood, Revolut, and other fintech-modern apps. Dark plus neon, glassmorphism, gradient text, oversized hype numerics.

## Design Principles

1. **Type does the work.** Hierarchy, status, and emphasis come from typographic scale and weight before they come from color, borders, or shadows.
2. **Quiet by default, confident at the brand layer.** The page recedes; the moss accent and the sidebar carry identity.
3. **Cards earn their borders.** Use them when data is genuinely separable. Never as default chrome. Never identical and grid-tiled.
4. **The page is a sheet of paper, not a UI kit.** Off-white surfaces, hairline rules, asymmetric rhythm.
5. **Honest numerics.** Tabular figures, decimals aligned, no decorative formatting. A number is a number.

## Accessibility & Inclusion

WCAG 2.1 AA. Specific commitments:

- Every inline-edit affordance must be a real button reachable by keyboard. No `<span onClick>`.
- Status communicated by more than color. Sign prefixes, icons, or text labels alongside hue (income vs expense vs transfer).
- 44 by 44 minimum touch targets on mobile. Row-action buttons that fall below this on desktop must expand or move into a kebab menu on touch.
- Reduced-motion honored. Animation durations collapse to zero when `prefers-reduced-motion: reduce`.
