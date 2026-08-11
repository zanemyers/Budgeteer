# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Budgeteer is a Django 6 + Inertia.js + React SPA, styled with Tailwind CSS v4. The backend serves data via `inertia_render()`; the frontend is a persistent React app with no full-page reloads. Authentication is handled by Django Allauth with all views overridden to return Inertia responses.

It is a personal, self-hosted app — one owner managing their own money, not multi-tenant SaaS — which drives choices like SimpleFIN over Plaid. `PRODUCT.md` (scope/features) and `DESIGN.md` (visual direction) at the repo root are authoritative for product and design decisions. Deeper authored docs live in `docs/` — notably `architecture.md`, `models.md`, and `database.md` (with a rendered `database.svg` ERD); serve them locally with `just docs`.

## Development Commands

All commands run inside Docker containers by default. Override with `PYTHON_CMD_PREFIX` / `NODE_CMD_PREFIX` env vars to run locally.

**Setup & Management:**
- `just start` - Start Docker Compose environment
- `just build` - Build Docker images and collect static files
- `just stop` - Stop all services
- `just clean` - Remove build artifacts, caches, coverage data

**Code Quality:**
- `just format` - Format all code (Python with Ruff, JS/TS/CSS with Biome, HTML with djLint)
- `just lint` - Lint everything (includes type checking with ty)
- `just pre_commit` - Run format, lint, and test pipeline

**Testing:**
- `just test` - Run pytest
- `just test_with_coverage` - Run tests with coverage HTML report
- Run a single test: `docker compose exec web pytest --ds=config.settings.test_runner path/to/test.py::TestClass::test_method`

**Asset Building:**
- `just build_frontend` - Build frontend assets with Vite
- `just collectstatic` - Run Django's collectstatic

**Database:**
- `just db_dump` - Dump database to `~/Downloads/`
- `just db_restore [dump_file]` - Restore from dump (defaults to latest in `~/Downloads/`)

**Dependencies:**
- `just upgrade_python_packages [pkg...]` - Upgrade all or specific Python packages via uv
- `just upgrade_node_packages` - Upgrade Node packages

## Architecture

### Inertia.js Request/Response Pattern

Every page is a React component rendered server-side via Inertia. Django views call `inertia_render(request, "ComponentName", props_dict)` which returns either a full HTML page (first load) or a JSON response (SPA navigation). The React component name must exactly match a file in `src/tsx/pages/`.

```python
# views.py pattern
from inertia import render as inertia_render


class MyView(BudgetMemberMixin, View):
    def get(self, request, budget_pk):
        return inertia_render(
            request,
            "MyPage",
            {
                "budget_pk": self.budget.pk,
                "items": lambda: [...],  # lambdas are evaluated lazily
            },
        )
```

### Shared Props via Middleware

`apps/base/inertia_middleware.py` (`InertiaShareMiddleware`) shares `auth.user` and `flash` messages with every Inertia response. The `auth.user` object contains `id`, `email`, `name`, `gravatar`, `is_staff`. Pages access this via `usePage<PageProps>().props.auth?.user`.

### Layouts

- **`AppLayout`** (`src/tsx/layouts/AppLayout.tsx`) — persistent sidebar + main content. Applied as the default layout for all pages in `main.tsx` via `page.default.layout ??= ...`.
- **`AuthLayout`** (`src/tsx/layouts/AuthLayout.tsx`) — centered card, no sidebar. Applied per-component: `Login.layout = (page) => createElement(AuthLayout, null, page)`.

`budget_pk` and `month` props on any page cause the sidebar to show a "Current Budget" section with budget-specific links.

### Budget Permission Mixins

All budget-scoped views use one of two mixins defined at the top of `apps/budget/views.py`:

- **`BudgetMemberMixin`** — verifies the user is a member of the budget from `budget_pk` URL kwarg, sets `self.budget`.
- **`BudgetOwnerMixin`** — extends `BudgetMemberMixin`, additionally requires `role=owner`.

Never use `LoginRequiredMixin` alone for budget views — always use one of these mixins.

### Domain Model (the ledger)

All budget domain models live in `apps/budget/models.py`. The core shape is worth internalizing before touching budget logic:

- **`Transaction` is a header; money lives on `TransactionLine` rows.** A transaction's amount is `total_amount` (sum of its lines), and each line carries a `category`, `amount`, and `amount_usd`. Nearly every transaction should have at least one line — generators backfill a canonical line so this holds. `transaction_type` is usually derived from the first line's category type (`derive_transaction_type`) rather than stored.
- **Currency is per-transaction.** Amounts are stored in the transaction's own `currency` with an `exchange_rate_to_usd` captured at entry time; lines store both `amount` and `amount_usd`. Don't assume USD.
- **`budget_month` (a first-of-month date) decides which month a transaction funds**, overriding `paid_date` bucketing. Income allocation is driven by `PaySchedule.allocation_offset_months` / `budget_month_for()` (0 = funds the received month, 1 = budget a month ahead).
- **Pending vs. paid:** `paid_date IS NULL` means pending/upcoming; a set `paid_date` means it happened.
- **`PaySchedule` and `RecurringTransaction` both generate `Transaction` instances** via `generate_instances_up_to(...)`, watermarked by `generated_through`; instances link back through the `pay_schedule` / `recurring` FKs (reverse name `instances`). The daily cron regenerates a lookahead window (`BUDGET_RECURRING_LOOKAHEAD_DAYS`, default 3) — days, deliberately, so a schedule only becomes a real `Transaction` shortly before it's due instead of filling the register with a month of unreconcilable rows on the 1st. Narrowing that setting needs a one-time `generate_recurring_instances --prune` to clear instances the old window created and rewind each `generated_through`, which otherwise sits past the new window and stalls generation. These generators only *fill nulls* when backfilling fields onto existing unpaid instances — they never clobber a value set manually on a specific instance.
- **Transfers** are two transactions linked via the self-referential `transfer_partner`; always mutate the link through `link_transfer()` / `unlink_transfer()` so both sides stay consistent.
- **`CategoryBudget`** is the per-category, per-month assigned target (`unique_together` on budget/category/month); categories support monthly rollover.

### Allauth Override Pattern

Auth views in `apps/accounts/views.py` use `InertiaAllauthMixin` to intercept allauth's `render_to_response`. GET requests and POST errors return Inertia responses; POST successes do an `HttpResponseRedirect` (bypassing the override). Custom auth views are registered **before** `include("allauth.urls")` in `config/urls.py` to take precedence.

Frontend auth forms POST with `Content-Type: application/x-www-form-urlencoded` + `X-Requested-With: XMLHttpRequest`. On `res.redirected`, call `router.visit(res.url)`.

### API Pattern for React Components

Non-page React components (modals, inline forms) communicate with the backend via `fetch`. All mutating requests send `X-CSRFToken` from `document.cookie`. Views return `JsonResponse`. GET requests that return a full page use `inertia_render`; API-only endpoints return `JsonResponse` directly.

### Scheduled Tasks

Scheduled work runs in a `cron` sidecar (`compose.yml`), not Celery Beat. Logic lives in Django management commands (the source of truth); `tasks.py` wrappers exist so the same job can be queued via Celery on demand.

For each scheduled job:
- **Source of truth**: `apps/<app>/management/commands/<name>.py` — the `Command.handle()` body
- **Celery wrapper** (optional, for ad-hoc queueing): `apps/<app>/tasks.py` → `@shared_task` that calls `call_command("<name>")`
- **Schedule**: line in `config/docker/crontab` calling `python manage.py <name>`

Currently scheduled: `update_exchange_rates --if-stale` (04:00 UTC), `generate_recurring_instances` (04:30 UTC). The Celery worker container still runs for ad-hoc `.delay()` calls but no Beat process exists.

### Frontend Structure

```
src/tsx/
  main.tsx              # Inertia app bootstrap, assigns AppLayout as default
  layouts/              # AppLayout, AuthLayout
  pages/                # One file per Inertia component (name must match Django view arg)
  components/           # Shared components: ThemeToggle, TransactionModal, LoadingSpinner
src/css/
  main.css              # Tailwind v4 entry + hand-rolled utility classes
```

Frontend tool configs (`vite.config.mjs`, `tsconfig.json`, `biome.json`, `stylelint.config.js`) all live at the repo root — auto-discovery is the path of least resistance for IDEs and the tools themselves.

Styling uses Tailwind CSS v4 via `@tailwindcss/vite`. `src/css/main.css` starts with `@import "tailwindcss"` and a `@custom-variant dark (&:where(.dark, .dark *))` declaration, then defines a set of Bootstrap-shaped utility classes (`.btn`, `.btn-primary`, `.card`, `.form-control`, `.table`, `.modal`, `.sidebar`, etc.) that the JSX consumes. When adding new UI, prefer Tailwind utilities directly; only extend `main.css` if you need a class that's reused across many components.

Dark mode is class-based: an inline script in `apps/base/templates/layouts/base.html` reads `localStorage.getItem("theme")` and toggles a `dark` class on `<html>` before CSS loads (prevents FOUC). `ThemeToggle.tsx` cycles auto → light → dark and persists to `localStorage`.

### Mobile-First UI, and the PWA Goal

**The phone is the primary target and the app is headed for PWA install**, so check any UI change at ~390px before you consider it done. `PRODUCT.md` and `DESIGN.md` are authoritative; the operational rules that recur:

- **A table must not scroll sideways on a phone.** Below `md`, mark secondary cells `hidden md:table-cell` and fold what matters into the primary cell — the amount beside the description, the date on a quiet line under it. `md:contents` on a mobile-only wrapper dissolves it from `md` up so the desktop table is untouched. Hide the header row with `hidden md:table-header-group`.
- **Header cells must hide in lockstep with their body cells**, or the columns silently stop lining up with their data. `TableHead` only sets `whitespace-nowrap` from `md` up, so a header that must not wrap needs its own `whitespace-nowrap`.
- **Rows open a modal; they don't edit inline.** One tap target per row, plus a real `<button>` inside it (usually the description) so there's a keyboard route. Stop propagation on anything else clickable in the row.
- **Bulk selection is a mode**, offered from the overflow menu — not a permanent checkbox column. When a table mixes row kinds (the pending tab holds transactions *and* bank rows), gate every checkbox cell on the same flag or the column counts diverge.
- **Secondary actions live in one `MoreHorizontal` dropdown.** Only the page's primary action keeps a button. Below `sm`, secondary buttons drop their label via `<span className="hidden sm:inline">` and keep `aria-label` + `title`.
- **Size touch targets with the `touch:` variant** (`@media (pointer: coarse)`, declared in `main.css`), not width breakpoints. Stack as `max-sm:touch:` when a target should only grow on a phone — unscoped, it also fires on a coarse-pointer tablet and clips labels that are still visible there.
- **Verify a new responsive class actually compiled** before trusting it: `grep` the built CSS under `public/static/dist/js/` after `just build_frontend`. A typo in an arbitrary or stacked variant fails silently.

PWA state: `public/static/manifest.webmanifest` exists and is linked from `base.html` (standalone, portrait-primary, 192/512 maskable icons, theme-color following the active theme). The service worker is `apps/base/templates/sw.js`, rendered by `apps.base.views.service_worker` and served at `/sw.js` — root path, because a worker can't control pages above the path it was served from — and registered from `main.tsx`. It's a view rather than a static file so the precache list can name the build's content-hashed filenames (`built_asset_urls()` in the vite templatetag module); the cache is named after a hash of that list, so a new build replaces the old cache on activate.

What it does and deliberately doesn't: hashed assets under `STATIC_URL + VITE_OUTPUT_DIR` are cache-first (a new build changes the URL, so a hit can't be stale); navigations are network-only, falling back to the precached `/offline/` page; **everything else — Inertia page data, the JSON endpoints the modals post to — stays on the network on purpose**, because quietly serving a stale balance is worse than an error. Don't add offline writes or data caching without deciding what happens to a stale ledger. In `VITE_DEV_MODE` the worker still installs but precaches only the offline page, since dev asset names change on every edit.

The deployment still has **no TLS**, and registration fails on any insecure origin except `localhost` — so a real install from a phone needs a certificate first.

### Apps Structure

- **`apps/accounts/`** — custom user model, Allauth adapter, auth views, account settings
- **`apps/base/`** — `InertiaShareMiddleware`, Vite template tags, base views, storage backend, `EncryptedTextField`
- **`apps/budget/`** — all budget domain logic: models, views, data serializers, migrations
- **`apps/banking/`** — SimpleFIN integration: `SimpleFINConnection` + `BankAccount` + `BankTransaction` models, `simplefin.py` client, `sync_simplefin` management command (scheduled), Celery `tasks.py` wrapper. Access URLs stored encrypted via `EncryptedTextField`.
- **`apps/investments/`** — `Holding` model + `ingest.py` for investment positions pulled from SimpleFIN-capable accounts.

`apps/budget/data.py` contains all serializer functions (`serialize_transaction`, `serialize_payment_method`, etc.) used by views to build Inertia props.

### Configuration

Settings live in `config/settings/`: `_base.py` (all shared config, environment-driven) and `test_runner.py` (test-only overrides). Environment variables are declared in `.env.toml` at the repo root (epicenv schema; each var is a `[variables.NAME]` block) and loaded from `.env` via epicenv. Generate a fresh `.env` with `just create_env`.

## Testing

- pytest + pytest-django; settings module: `config.settings.test_runner`
- `model-bakery` and `django-test-plus` are installed (dev deps) but not yet adopted in the suite
- Coverage config: `[tool.coverage.*]` sections in `pyproject.toml`

## Code Standards

- **Python**: Ruff (format + lint), type-checked with ty; 120-char line length
- **JavaScript/TypeScript/CSS**: Biome (`biome.json`) handles all three. CSS parser is configured with `tailwindDirectives: true` for Tailwind v4 at-rules. `bun run lint` lints; `bun run format` runs `biome check --write` (lint + format with fixes).
- **HTML**: djLint; 120-char line length, 2-space indent
