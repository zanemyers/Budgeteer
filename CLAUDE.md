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

Two things about stale assets, both of which have wasted time here:

- **`collectstatic` copies but never deletes.** `STATIC_ROOT` (`collected_static/`) is a different directory from Vite's `outDir` (`public/static/dist/js/`, which `emptyOutDir` does clean), so a removed feature's old content-hashed bundle keeps sitting there beside the new one. Nothing serves it — the manifest names the new file — but it will still match a `grep` for code you thought you deleted. Use `collectstatic --clear` when that matters.
- **The `node` container can wedge when `vite.config.mjs` changes.** Vite watches its own config and restarts; that restart sometimes never completes, leaving `docker compose ps` showing `node` as **unhealthy** while Django happily keeps serving HTML — so the symptom is a blank page with no server-side error. The tell is `vite.config.mjs changed, restarting server...` in `docker compose logs node` with no matching `server restarted.`. `docker compose restart node` fixes it. Expect it after anything that rewrites that file, including `just format`.

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
- **Transfers were retired.** There is no two-leg pairing: an account-to-account movement is handled by ignoring the bank row, which was simpler than keeping two transactions in step. `transaction_type="transfer"` survives for one reason — a goal deposit is written with it, and the ready-to-assign and goal-balance sums in `data.py` exclude it so moving money into a goal doesn't read as income *or* spending. Don't reintroduce a partner field; see migrations 0002/0003.
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

Styling uses Tailwind CSS v4 via `@tailwindcss/vite`. `src/css/main.css` holds the self-hosted `@font-face` rules, the OKLCH token blocks (`:root` / `.dark`), their `@theme inline` mapping to Tailwind color utilities, and a small number of hand-written classes — `.sidebar*`, `.tabular`, `.touch-target`, `.scrollbar-none`, and `.standalone`. When adding new UI, prefer Tailwind utilities directly; only extend `main.css` if you need a class reused across many components.

**Use a token, never a numbered Tailwind color.** `bg-amber-500` and friends are fixed sRGB values that can't follow the theme, and `text-white` is only safe on a background that's dark in *both* themes — `--moss`, `--alarm` and `--fund` all invert to ~72% lightness in dark mode, where white lands near 2.4:1. Each saturated background has a paired foreground (`text-moss-foreground`, `text-destructive-foreground`, `text-fund-foreground`). `apps/base/tests/test_design_token_contrast.py` enforces both rules — it parses `main.css` for the token math and greps the JSX for the two anti-patterns, because these failures are invisible in review.

Dark mode is class-based: an inline script in `apps/base/templates/app.html` reads `localStorage.getItem("theme")` and toggles a `dark` class on `<html>` before CSS loads (prevents FOUC). `ThemeToggle.tsx` cycles auto → light → dark and persists to `localStorage`. Note the `dark` class lands on `<html>`, the same element `:root` matches — which is what lets `--background: var(--paper)` pick up the dark `--paper`. A nested `.dark` island would not work.

**Inter is self-hosted**, not loaded from Google Fonts, in two `unicode-range`-split subsets under `src/fonts/`: `latin` (73 KB, needed by every page) and `latin-ext` (134 KB, which carries the `U+20A0-20C0` currency block — ₹ ₽ ₩ ₪ ₫ — so a dollars-only budget never fetches it). Vite hashes and emits them, which puts them under the service worker's cache-first asset prefix and into its precache list automatically. `{% vite_font_preload %}` in `app.html` preloads only the latin subset; without it the font is discovered a round trip after first paint and the page visibly reflows out of system-ui. Currency symbols outside both subsets (the Arabic, Cyrillic and Thai ones in `currency_symbols.csv`) fall back to a system face — Inter has no glyphs for them either.

### Two template shells, and only two

- **`app.html`** (`INERTIA_LAYOUT`) — the React app. Everything a signed-in user touches.
- **`layouts/standalone.html`** — server-rendered pages with no bundle: `404.html`, `500.html`, and any Allauth page not shadowed by an Inertia view. Styled by the element-scoped `.standalone` rules in `main.css` rather than utility classes, so it doesn't depend on Tailwind scanning the template directory. `500.html` is rendered by `handler500` with an **empty context** — no request, no context processors — so nothing in that chain may require a template variable.
- **`offline.html`** stays deliberately standalone with its tokens inlined, because the service worker serves it when there's no network to fetch a stylesheet from.

Allauth is themed at **one** point: `allauth/layouts/base.html`, which our copy overrides (`apps.base` precedes `allauth` in `INSTALLED_APPS`). Both `entrance.html` and `manage.html` extend it and add nothing, so overriding per-page templates is unnecessary — and `account/base_entrance.html` is the wrong hook, since Allauth's own `account_inactive.html` bypasses it. `/accounts/email/`, `/accounts/password/change/` and `/accounts/password/set/` are shadowed by redirects to `account_settings`, which already owns those rows; their URL names are kept so Allauth's internals and links in already-sent emails still resolve.

### Production mode is barely exercised

Everything local runs `DEBUG=True`, and a bug that took down *every page* under `DEBUG=False` survived in the repo for months because of it: `VITE_MANIFEST_FILE` defaulted under `STATIC_ROOT`, where `collectstatic` can never place it (staticfiles ignores `.*`, Vite emits `.vite/manifest.json`), so the first `vite_asset` call raised `FileNotFoundError`. It now reads from Vite's own `outDir`.

**Smoke-test production mode after touching settings, templates or the build.** There's no separate settings module for it — override the two things that assume TLS and a managed database:

```
docker compose exec -T -e DEBUG=False -e SECURE_SSL_REDIRECT=False -e DB_SSL_REQUIRED=False \
  -e ALLOWED_HOSTS=localhost,127.0.0.1,testserver web python manage.py runserver --insecure --noreload 0.0.0.0:8002
```

The container has no `curl`, `ps` or `pkill`, so drive it with Django's test `Client` under `override_settings(DEBUG=False, VITE_DEV_MODE=False)` instead — that also sidesteps `SESSION_COOKIE_SECURE = not DEBUG`, which otherwise stops a session sticking over http, and `force_login` gets you the authenticated pages. `docker compose restart web` is how you stop a stray server.

### Pages are lazily loaded

`main.tsx` resolves pages with `import.meta.glob` **without** `eager: true`, so each page is its own chunk. `resolve` returns `module.default` rather than the module: Inertia's `ComponentResolver` accepts a component, a promise of one, or a synchronous `{ default }` — but not a promise of a module. `{% vite_modulepreload 'tsx/main.tsx' %}` emits `modulepreload` links for the entry's static-import closure, which Vite would normally inject itself into HTML it generates; without them the browser can't discover the shared chunks until it has parsed the entry.

### Mobile-First UI, and the PWA Goal

**The phone is the primary target and the app is headed for PWA install**, so check any UI change at ~390px before you consider it done. `PRODUCT.md` and `DESIGN.md` are authoritative; the operational rules that recur:

- **A table must not scroll sideways on a phone.** Below `md`, mark secondary cells `hidden md:table-cell` and fold what matters into the primary cell — the amount beside the description, the date on a quiet line under it. `md:contents` on a mobile-only wrapper dissolves it from `md` up so the desktop table is untouched. Hide the header row with `hidden md:table-header-group`.
- **Header cells must hide in lockstep with their body cells**, or the columns silently stop lining up with their data. `TableHead` only sets `whitespace-nowrap` from `md` up, so a header that must not wrap needs its own `whitespace-nowrap`.
- **Rows open a modal; they don't edit inline.** One tap target per row, plus a real `<button>` inside it (usually the description) so there's a keyboard route. Stop propagation on anything else clickable in the row.
- **Below `sm` a dialog is a bottom sheet; from `sm` up it's a centred card.** The sheet is anchored to the bottom edge, `rounded-t-2xl`, and its height follows its content up to `88dvh` — so a two-line confirm is two lines tall, not a full screen with its buttons stranded mid-display. `DialogFooter` stays `sticky bottom-0` with an opaque background (negative margins so it spans the sheet's own padding) to keep the primary action reachable while the content scrolls.
- **The keyboard is handled by `--keyboard-inset`, not by owning the screen.** A fixed element is positioned against the *layout* viewport, and iOS Safari does not shrink that when the keyboard opens — Chrome's `interactive-widget` directive would, but Safari doesn't implement it, and Safari is the reason this is needed. `useKeyboardInset` in `dialog.tsx` publishes `innerHeight - visualViewport.height - visualViewport.offsetTop` as `--keyboard-inset` on `<html>` while a dialog is open; the sheet subtracts it from both `bottom` and its max height, so it rides on top of the keyboard and shrinks rather than being covered. The listener only exists while a dialog is mounted.
- **The grab handle really drags.** It's bound to the handle alone, never the sheet body, or it would fight the sheet's own scrolling. Past 80px it dismisses, shorter springs back, and upward drags clamp to zero so the sheet can't be lifted off the edge it's anchored to. It dismisses through a hidden `DialogPrimitive.Close` rather than the visible ✕, which a caller can switch off with `showCloseButton={false}` — otherwise the handle would look draggable and do nothing.
- **A long form is shortened by putting fields on a row, not behind a disclosure.** Two or three narrow controls beat as many rows of scroll. When a picker's selected value won't fit, pass children to `SelectValue` to shorten just the trigger (`<SelectValue>{form.currency}</SelectValue>` shows `USD` while the list keeps `USD — US Dollar`); Radix renders `children` over the selected item's text. **Free text is the exception** — a note or description takes its own row, since it has no bounded value to size against.
- **Don't put a fixed-size control in a fractional grid column.** `TransactionModal`'s split rows were a 12-column grid with the remove button in `col-span-1` — about 27px at 390px for a button that will not go below 32px, so it pushed the whole grid wider than the dialog and the modal scrolled sideways. Use flex and let the button take its natural width (`shrink-0`), give the fixed-width field an explicit width, and let the one flexible control absorb the rest with `flex-1 min-w-0`.
- **Bulk selection is a mode**, offered from the overflow menu — not a permanent checkbox column. When a table mixes row kinds (the pending tab holds transactions *and* bank rows), gate every checkbox cell on the same flag or the column counts diverge.
- **Secondary actions live in one `MoreHorizontal` dropdown.** Only the page's primary action keeps a button. Below `sm`, secondary buttons drop their label via `<span className="hidden sm:inline">` and keep `aria-label` + `title`.
- **Menu items are bare verbs — "Edit", "Delete".** The menu hangs off the row it acts on, so repeating the noun ("Edit recurring transaction") only widens the menu until it overhangs the screen edge. Name the thing in the confirm dialog, where it's the only context available, and in the trigger's `aria-label`.
- **Size touch targets with the `touch:` variant** (`@media (pointer: coarse)`, declared in `main.css`), not width breakpoints. Stack as `max-sm:touch:` when a target should only grow on a phone — unscoped, it also fires on a coarse-pointer tablet and clips labels that are still visible there.
- **`TableCell` and `TableHead` hard-code `md:whitespace-nowrap`**, so from `md` up a single long value sets its column's min-content width and the table scrolls rather than wraps. That's right for figures and wrong for free text: one 50-character goal name pushed the dashboard's goals card 68px past its column at 1280px. Fix it by letting the *inner* element wrap (`whitespace-normal` on the link or button inside the cell) — a competing `md:whitespace-normal` on the cell itself is resolved by Tailwind's internal property ordering, not by source order, so it's a coin flip. If wrapping isn't enough, fold a column into the primary cell as below. A card in the `md:col-span-4` sidebar has only 224–290px between `md` and `xl`, which will not hold three figure columns.
- **Verify a new responsive class actually compiled** before trusting it: `grep` the built CSS under `public/static/dist/js/` after `just build_frontend`. A typo in an arbitrary or stacked variant fails silently. Without rebuilding, `curl` the dev server's stylesheet instead — but send `-H "Sec-Fetch-Dest: style"`, or Vite returns the HMR *JavaScript* wrapper, in which case the classes are there but escaped (`sm\\:text-sm`) and a naive grep misses them.

**To open the app on a real phone** (same Wi-Fi, `http://<this-machine-lan-ip>:8000`), two things must be set in `.env` — both default to a localhost-only setup, and each fails in its own quiet way:

- `ALLOWED_HOSTS=localhost,127.0.0.1,<lan-ip>` — under `DEBUG` Django only auto-allows localhost, so the LAN IP returns a bare **400 DisallowedHost**.
- `VITE_SERVER_HOST=<lan-ip>` — the vite templatetag writes this into every dev asset URL, and it has to be resolvable by the *client*. Left at `localhost`, the phone resolves it to itself and the page renders **blank with nothing in the Django log** — the HTML loads fine from Django and only the asset requests fail, refused by a dev server that isn't on the phone.

A third failure has the same blank-page symptom and is already fixed in `vite.config.mjs`: Vite only sends `Access-Control-Allow-Origin` to localhost origins by default, and `type="module"` scripts are always fetched in CORS mode, so `server.cors.origin` extends Vite's exported `defaultAllowedOrigins` with `192.168.x.x`. Widen that regex if your router hands out `10.x` or `172.16–31.x`. Note the whole setup lives in `.env`, which is gitignored — it is not reproducible from a clone.

None of this gets you a PWA install: a LAN IP is not a secure origin, so `serviceWorker.register` is unavailable. That still needs TLS.

PWA state: `public/static/manifest.webmanifest` exists and is linked from `base.html` (standalone, portrait-primary, 192/512 maskable icons, theme-color following the active theme). The service worker is `apps/base/templates/sw.js`, rendered by `apps.base.views.service_worker` and served at `/sw.js` — root path, because a worker can't control pages above the path it was served from — and registered from `main.tsx`. It's a view rather than a static file so the precache list can name the build's content-hashed filenames (`built_asset_urls()` in the vite templatetag module); the cache is named after a hash of that list, so a new build replaces the old cache on activate.

What it does and deliberately doesn't: hashed assets under `STATIC_URL + VITE_OUTPUT_DIR` are cache-first (a new build changes the URL, so a hit can't be stale); navigations are network-only, falling back to the precached `/offline/` page; **everything else — Inertia page data, the JSON endpoints the modals post to — stays on the network on purpose**, because quietly serving a stale balance is worse than an error. Don't add offline writes or data caching without deciding what happens to a stale ledger. In `VITE_DEV_MODE` the worker still installs but precaches only the offline page, since dev asset names change on every edit.

The deployment still has **no TLS**, and registration fails on any insecure origin except `localhost` — so a real install from a phone needs a certificate first.

### Apps Structure

- **`apps/accounts/`** — custom user model, Allauth adapter, auth views, account settings
- **`apps/base/`** — `InertiaShareMiddleware`, Vite template tags, base views, storage backend, `EncryptedTextField`
- **`apps/budget/`** — all budget domain logic: models, views, data serializers, migrations
- **`apps/banking/`** — SimpleFIN integration: `SimpleFINConnection` + `BankAccount` + `BankTransaction` models, `simplefin.py` client, `sync_simplefin` management command (scheduled), Celery `tasks.py` wrapper. Access URLs stored encrypted via `EncryptedTextField`.
  - **A re-link can reissue an account's SimpleFIN id.** Accounts upsert on `(connection, simplefin_id)`, so that would create a second row — old one frozen, still holding its transactions and its payment-method mapping. `_adopt_reissued_account` claims the existing row instead, but only when exactly one account matches on name and institution *and* its id has vanished from the payload being processed. That second condition is the safety: an account still in the feed is a live account that merely shares a name. `merge_duplicate_bank_accounts` (dry-run by default, `--apply` to write) cleans up pairs that predate it.
  - **Carrying the payment method matters more than it looks.** `BankTransaction.for_budget` reaches a budget *through* `bank_account__payment_method__budget`, so an account with no payment method is invisible to every budget — which is also why hiding an account on the Banking page is display-only and can't affect the ledger.
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
