# Design

Budgeteer's visual system: quiet-utility / Nordic lane with a confidently-deployed moss accent. Cards stay as the primary container affordance but must be quiet (hairline rules, no shadows) and varied in size (never identical-grid). Type carries hierarchy. Paper neutrals on warm off-white, ink charcoal text, moss carries brand.

## Theme

**Both light and dark are first-class.** A user reviews finances on a desktop in the evening (lamp light, calm focus) and glances at the app on a phone in bed (low ambient light). The system does not have a "default" theme in the philosophical sense; it has equal commitment to both.

Dark mode is class-based (`.dark` on `<html>`) with a pre-CSS inline script preventing FOUC. The script reads `localStorage.getItem("theme")` and toggles the class.

## Color

**Strategy:** Committed (~30–60% surface). The moss accent is visible on the sidebar (full surface), primary buttons, section headers, active nav, and brand-mark — enough that the identity is unmistakable without the page feeling drenched.

All values OKLCH. All neutrals tinted toward the moss hue (`130`) at low chroma (≤0.015) so the page never feels clinical.

### Light tokens

| Name | Value | Role |
|---|---|---|
| `--paper` | `oklch(98% 0.005 100)` | Page background — warm off-white |
| `--ink` | `oklch(22% 0.015 130)` | Body text |
| `--ink-quiet` | `oklch(48% 0.012 130)` | Secondary text, meta |
| `--rule` | `oklch(88% 0.008 110)` | Hairline borders, dividers |
| `--surface` | `oklch(96% 0.006 100)` | Card and inset panels |
| `--surface-strong` | `oklch(94% 0.008 100)` | Form inputs, hover states |
| `--moss` | `oklch(48% 0.07 130)` | Brand accent — sidebar, primary buttons, active states. |
| `--moss-soft` | `oklch(88% 0.06 130)` | Accent backgrounds, section header bands |
| `--moss-foreground` | `oklch(98% 0.005 100)` | Text on moss |
| `--income` | `oklch(52% 0.06 145)` | Income data only |
| `--expense` | `oklch(50% 0.10 25)` | Expense data only |
| `--expense-soft` | `oklch(90% 0.045 25)` | Expense header band |
| `--fund` | `oklch(60% 0.08 70)` | Goal accent (warm earth) |
| `--fund-soft` | `oklch(90% 0.06 70)` | Goal header band |
| `--ongoing` | `oklch(55% 0.07 250)` | Ongoing-goal accent (slate-blue) |
| `--alarm` | `oklch(45% 0.13 25)` | True destructive only (delete confirm) |

### Dark tokens

| Name | Value |
|---|---|
| `--paper` | `oklch(23% 0.008 130)` |
| `--ink` | `oklch(94% 0.008 100)` |
| `--ink-quiet` | `oklch(68% 0.010 110)` |
| `--rule` | `oklch(32% 0.012 130)` |
| `--surface` | `oklch(27% 0.010 130)` |
| `--surface-strong` | `oklch(30% 0.012 130)` |
| `--moss` | `oklch(72% 0.09 130)` |
| `--moss-soft` | `oklch(36% 0.07 130)` |
| `--moss-foreground` | `oklch(15% 0.010 130)` |
| `--income` | `oklch(72% 0.07 145)` |
| `--expense` | `oklch(72% 0.10 25)` |
| `--expense-soft` | `oklch(34% 0.06 25)` |
| `--fund` | `oklch(75% 0.10 70)` |
| `--fund-soft` | `oklch(34% 0.07 70)` |
| `--ongoing` | `oklch(72% 0.08 250)` |
| `--alarm` | `oklch(65% 0.14 25)` |

### shadcn token mapping

To keep shadcn components on-brand without forking them, the standard tokens redirect to the new palette:

- `--background` → `--paper`
- `--foreground` → `--ink`
- `--card` → `--surface`
- `--card-foreground` → `--ink`
- `--primary` → `--moss`
- `--primary-foreground` → `--moss-foreground`
- `--muted` → `--surface`
- `--muted-foreground` → `--ink-quiet`
- `--border` → `--rule`
- `--input` → `--rule`
- `--ring` → `--moss`
- `--destructive` → `--alarm`

## Typography

**Body:** Inter (Google Fonts). Replaces DM Sans. Inter has tabular-nums and feels honestly neutral.

**Numerics:** Inter with `font-variant-numeric: tabular-nums` applied globally on numeric cells. Decimals align. No proportional figures in tables.

**Display (page H1, large numbers):** Inter at `font-weight: 600` and `letter-spacing: -0.02em`.

### Scale

| Role | Size | Weight | Tracking |
|---|---|---|---|
| Display (page H1, headline numerics) | 28–32px | 600 | -0.02em |
| H2 (section bands like "EXPENSES") | 13px UPPERCASE | 600 | 0.08em |
| Body | 14px | 400 | 0 |
| Body strong | 14px | 500 | 0 |
| Meta / quiet | 12px | 400 | 0 |
| Numerics | inherits size | 500 | tabular-nums |

Step ratio between H1 and H2 ≥ 1.25. Avoid flat scales.

## Layout

- **Cards** are quiet: `1px solid var(--rule)` border, `background: var(--surface)`, `border-radius: 8px`, **no shadow**.
- Card sizes vary deliberately — never three-same-size in a row. Asymmetric is the antidote to identical-grid.
- Card headers (when used) carry a tinted band in `--moss-soft` or `--fund-soft` with H2 type. Reserve bands for cards that genuinely need labeling (Income, Expenses, All Funds). Plain cards use no band.
- **Inside cards**, separate sections by `1px var(--rule)` horizontal lines. Never inner cards.
- **Spacing scale:** `4 / 8 / 12 / 16 / 24 / 40 / 64`. Vary inside vs between cards (tight inside, generous between).
- **Container max-width** for content-heavy pages: ~1200px. Don't wrap everything; settings pages and forms cap at ~600px.
- **Page background** is `var(--paper)`. The body of every page sits directly on paper unless cards are needed.

## Mobile

The phone is the primary target and the app is headed for PWA installation, so a screen is judged at ~390px before it is judged wide. The test is whether it reads as a clean list you can act on with a thumb, not whether the desktop layout technically fits.

- **Never scroll a table sideways to reach the number.** Below `md`, hide the secondary columns and fold what matters into the primary cell: the amount rides beside the description, the date sits on a quiet line underneath. Anything recoverable by filtering (category, payment method) does not earn a place on a phone.
- **Drop the column-header row below `md`** (`hidden md:table-header-group`). Two meaningful columns need no labels, and the header is what makes a list read as a spreadsheet.
- **One tap target per row.** The row itself opens the editor. No inline field editing on a phone — a modal is the right place to change a value with a thumb. Keep one real `<button>` inside the row (usually the description) so there is still a keyboard route.
- **Selection is a mode, not a permanent column.** Offer it from the overflow menu; while it is on, a tap picks rows out and checkboxes appear. A column of empty boxes down the page is the thing being avoided.
- **Secondary actions collapse into one overflow menu** (`MoreHorizontal`). Only the page's reason-for-being keeps a button of its own — "+ Add" on Transactions. Filters stay out of that menu: they belong beside the search box, with a count of what is currently narrowing the list.
- **Labels drop to icons below `sm`** on secondary buttons. Keep `aria-label` and `title` so the name survives for screen readers and desktop hover.
- **Size touch targets with the `touch:` variant** (`@media (pointer: coarse)`), not a width breakpoint — the question is whether it is a finger, not how wide the window is. Stack it as `max-sm:touch:` when a target should only grow on a phone, or a coarse-pointer tablet will inflate a button that still has its label.
- **Give rows room.** Two lines of content want more than `p-2`; `max-md:py-3` on the cell that sets row height.

## Iconography

**Lucide-react** throughout. Retire all glyph-as-icon (`«` `»` `✕` `✔` `↺` `◎` `↳` `▾` `‹` `›`). Specific replacements:

| Before | After |
|---|---|
| `«` `»` | `ChevronLeft` `ChevronRight` |
| `✕` | `X` |
| `✔` | `Check` |
| `↺` | `RotateCcw` |
| `◎` | `PiggyBank` or `CircleDot` |
| `↳` | `CornerDownRight` (or just indentation) |
| `▾` `▼` `▲` | `ChevronDown` `ChevronUp` |

Icon-only buttons must carry `aria-label`.

## Motion

- **Page transitions:** instant. Inertia SPA — feels snappy, no fade-on-nav.
- **Inline-edit focus:** 120ms `cubic-bezier(0.22, 1, 0.36, 1)` (ease-out-quart).
- **Modal:** 180ms fade + 4px translate, same curve.
- **Hover:** 120ms color/background transitions only. Never animate layout properties.
- **Reduced motion:** `@media (prefers-reduced-motion: reduce)` collapses durations to zero.

## Components

Shadcn/ui is the substrate. Components inherit the new tokens automatically through the mapping above.

### Custom patterns

- **Inline-edit cells:** wrap the affordance in a real `<button>` (keyboard-reachable). Never `<span onClick>`. Focus ring uses `--ring` (mapped to `--moss`).
- **Sidebar:** `--moss` background in both themes, white text, active item gets a `--paper` strip on the left edge or a `--moss-soft`-on-`--moss` lift. All colors come from tokens — no hex literals.
- **Status pills** (Active, Inactive, Paid, etc.): replaced wherever possible by typographic micro-labels in `--ink-quiet`. Reserve Badge component for genuinely state-bearing labels (Recurring, Transfer).

## Numeric & data conventions

- Income amounts prefix with `+` only when ambiguous; default is unsigned positive.
- Expense amounts prefix with `−` (true minus sign, not hyphen) and use `--expense` color.
- Negative balances use both sign and color.
- Currency symbols stick to the digits, no space.
- Decimals always present in tables (e.g. `82.00`, not `82`).
- "—" placeholder for null cells. Never em dash in copy; the `—` placeholder is a glyph not a punctuation mark.

## Copy tone

Plain, second-person, unhurried. "You earned 5,420" beats "Income Total: $5,420.00". Empty states invite, not apologize. No exclamation points. No em dashes anywhere.
