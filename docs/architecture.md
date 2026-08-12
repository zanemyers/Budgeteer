# Architecture

Budgeteer is a Django + Inertia.js + React single-page application. Django handles routing, authentication, and data persistence. Inertia.js bridges the backend and frontend — the server renders page data as JSON props and the React frontend handles all navigation without full-page reloads.

## Request Lifecycle

1. Browser requests a URL → Django routes to a CBV
2. The view calls `inertia_render(request, "PageName", props)` (from `inertia-django`)
3. On first load, Inertia returns a full HTML page with the props embedded as JSON
4. On subsequent SPA navigations, Inertia returns only a JSON response with updated props
5. React swaps the component and updates the page without a reload

```python
# Standard view pattern
from inertia import render as inertia_render


class TransactionListView(BudgetMemberMixin, View):
    def get(self, request, budget_pk):
        return inertia_render(
            request,
            "Transactions",
            {
                "budget_pk": self.budget.pk,
                "transactions": lambda: [...],  # lambdas evaluated lazily
            },
        )
```

The component name passed to `inertia_render` must exactly match the filename in `src/tsx/pages/` (e.g. `"Transactions"` → `src/tsx/pages/Transactions.tsx`).

## Shared Props

`apps/base/inertia_middleware.py` (`InertiaShareMiddleware`) automatically shares two props with every response:

- **`auth.user`** — `{ id, email, name, gravatar, is_staff }` for authenticated users, absent otherwise
- **`flash`** — array of Django messages `{ level, message }` forwarded from the previous request

Access in React via `usePage<PageProps>().props`.

## Layouts

Two layouts exist in `src/tsx/layouts/`:

| Layout | Used for | Sidebar |
|--------|----------|---------|
| `AppLayout` | All authenticated pages | Yes — full sidebar with nav |
| `AuthLayout` | Login, password reset, email confirm | No — centered card |

`AppLayout` is the default, applied automatically in `main.tsx`:
```ts
page.default.layout ??= (page) => createElement(AppLayout, null, page);
```

Auth pages override this per-component:
```ts
Login.layout = (page) => createElement(AuthLayout, null, page);
```

The sidebar shows a **"Current Budget"** section whenever the page props include `budget_pk`. That prop is set by all budget-scoped views via `BudgetMemberMixin`.

## Permission Mixins

All budget-scoped views use one of two mixins in `apps/budget/views.py`:

```
LoginRequiredMixin
└── BudgetMemberMixin   — verifies user is a budget member; sets self.budget
    └── BudgetOwnerMixin — additionally requires role=owner
```

`BudgetMemberMixin` resolves `budget_pk` from the URL kwargs and raises 404 for non-members. Views that only need read access use `BudgetMemberMixin`; views that mutate budget-level settings (rename, delete, manage members) use `BudgetOwnerMixin`.

## Allauth Override Pattern

Auth views in `apps/accounts/views.py` override allauth's CBVs using `InertiaAllauthMixin`:

- **GET requests** → calls `render_to_response` → returns Inertia HTML
- **POST errors** → allauth re-renders the form → `render_to_response` intercepts, returns Inertia JSON or 422 JSON (when `X-Requested-With: XMLHttpRequest`)
- **POST success** → allauth issues `HttpResponseRedirect`, bypassing `render_to_response`

Custom auth URLs are registered **before** `include("allauth.urls")` in `config/urls.py` so they take priority.

Frontend auth forms POST with `application/x-www-form-urlencoded` + `X-Requested-With: XMLHttpRequest`. On `res.redirected`, call `router.visit(res.url)` to complete the SPA navigation.

## API Endpoints for React Components

Non-page interactions (modals, inline forms) use `fetch` directly rather than Inertia navigation:

- Views return `JsonResponse` for API-only endpoints
- All mutating requests include `X-CSRFToken` extracted from `document.cookie`
- Successful mutations return the updated serialized object; errors return `{ "errors": {...} }` or `{ "error": "..." }` with an appropriate status code

Serializer functions live in `apps/budget/data.py` and are shared between Inertia props and JSON responses.

## Frontend Structure

```
src/
  css/
    main.css                # Tailwind v4 entry + hand-rolled utility classes
  tsx/
    main.tsx                # Inertia bootstrap, default layout assignment
    layouts/
      AppLayout.tsx         # Persistent sidebar, user dropdown, SPA logout
      AuthLayout.tsx        # Centered card for auth pages
    pages/                  # One file per Inertia page (name = component name)
    components/             # Shared: ThemeToggle, TransactionModal, LoadingSpinner, BankTransactionConfirmModal…
      ui/                   # shadcn primitives (Button, Dialog, Table, Select, Badge…)
    lib/
      api.ts                # jsonFetch (throws on non-2xx), getCsrfToken
      utils.ts              # cn(), etc.
    utils/                  # currency, date, month formatters
    types.ts                # Shared TS types matching apps/*/data.py serializers
```

Mutations from non-page components (modals, inline edits) go through `jsonFetch` in `lib/api.ts` — never raw `fetch`. Errors surface as `sonner` toasts.

### Dialogs are full-screen on a phone

`components/ui/dialog.tsx` is shared by every modal, and below the `sm` breakpoint `DialogContent` takes the whole viewport (`inset-0 h-dvh`) instead of centring, while `DialogFooter` becomes `sticky bottom-0`. From `sm` up it is the usual centred card.

This is about the software keyboard. A centred dialog is positioned against the layout viewport, which the keyboard does not shrink — it simply draws over the lower half, covering whichever field was just tapped. When the dialog owns the screen, the keyboard only covers the bottom of a scroll container, and the browser scrolls the focused input into view on its own; the pinned footer keeps the primary action reachable without scrolling past every field. No `visualViewport` JavaScript is involved, and it does not depend on browser support for the viewport meta `interactive-widget` property.

The trade-off is that a two-line confirm dialog also goes full-screen, with empty space below its buttons. If that becomes annoying, the fix is an opt-out prop on `DialogContent` rather than reverting the default.

Frontend tool configs (`vite.config.mjs`, `tsconfig.json`, `biome.json`) live at the repo root. Biome handles linting and formatting for JS/TS *and* CSS — its CSS parser has `tailwindDirectives: true` so Tailwind v4 at-rules (`@import "tailwindcss"`, `@custom-variant`, `@theme`, `@apply`, etc.) parse cleanly.

## Theme System

- `src/css/main.css` holds the self-hosted `@font-face` rules, the OKLCH token blocks (`:root` and `.dark`), their `@theme inline` mapping onto Tailwind color utilities, and a short list of hand-written classes: `.sidebar*`, `.tabular`, `.touch-target`, `.scrollbar-none` and `.standalone`.
- An inline script in `apps/base/templates/app.html` reads `localStorage.getItem("theme")` and toggles a `dark` class on `<html>` **before CSS loads**, preventing flash of unstyled content. The class lands on `<html>` — the same element `:root` matches — which is what lets an alias like `--background: var(--paper)` resolve to the dark value; a nested `.dark` island would not.
- `ThemeToggle` cycles auto → light → dark → auto, persisting to `localStorage`.
- Every saturated background carries a paired foreground token (`--moss-foreground`, `--destructive-foreground`, `--fund-foreground`). A literal `text-white` is only correct on something dark in both themes, since `--moss`, `--alarm` and `--fund` all invert to roughly 72% lightness in dark mode. `apps/base/tests/test_design_token_contrast.py` asserts the ratios by parsing `main.css`, and separately greps the JSX for `text-white` on a brand background and for numbered Tailwind palette colors — contrast regressions read as tasteful in review, so they're pinned rather than eyeballed.

## Template Shells

There are two, plus the offline page:

| Template | Serves | Notes |
|----------|--------|-------|
| `app.html` | The React SPA (`INERTIA_LAYOUT`) | Favicons, manifest, theme-color, font preload, modulepreload, the bundle |
| `layouts/standalone.html` | `404.html`, `500.html`, unshadowed Allauth pages | No React bundle; styled by the element-scoped `.standalone` rules so it needs no Tailwind template scanning |
| `offline.html` | Service-worker navigation fallback | Deliberately self-contained with tokens inlined — it renders when no stylesheet can be fetched |

`500.html` is rendered by Django's `handler500` with an empty context (no request, no context processors), so nothing in that chain may depend on a template variable.

Allauth is themed at a single point: our `allauth/layouts/base.html` overrides Allauth's (`apps.base` precedes `allauth` in `INSTALLED_APPS`). `allauth/layouts/entrance.html` and `manage.html` both extend it and add nothing, so every page Allauth renders — `reauthenticate`, `account_inactive`, `confirm_login_code`, and anything a future version adds — arrives on the app's shell. Overriding `account/base_entrance.html` instead would miss `account_inactive.html`, which extends the layout directly.

`/accounts/email/`, `/accounts/password/change/` and `/accounts/password/set/` redirect to `account_settings`, whose Email addresses and Password rows already do the job. Their URL names are preserved so Allauth's internals and links in already-sent emails still resolve.

## Apps

| App | Responsibility |
|-----|---------------|
| `apps/accounts/` | Custom `User` model, Allauth adapter, auth views, account settings view |
| `apps/base/` | `InertiaShareMiddleware`, Vite template tags (`{% vite_asset %}`), storage backend, `EncryptedTextField`, shared `Currency` model |
| `apps/budget/` | All budget domain: models, views, serializers (`data.py`), migrations |
| `apps/banking/` | SimpleFIN integration: connection/account/transaction models, `simplefin.py` client, `sync_simplefin` command, Celery task wrapper |
| `apps/investments/` | `Holding` model + `ingest.py` for investment positions pulled from SimpleFIN-capable accounts |

## Configuration

Settings live in `config/settings/`:
- `_base.py` — all shared config, environment-driven
- `test_runner.py` — test-only overrides

Environment variables are declared in `.env.toml` at the repo root (each var is a `[variables.NAME]` TOML table) and loaded from `.env` via epicenv. Regenerate `.env` with `just create_env`.

### Opening the dev app on a phone

The phone is the primary target, so it is worth testing on a real device rather than a narrow browser window. Both ports are already published on all interfaces in `compose.yml` (`8000` for Django, `3000` for Vite); what stops it working is two localhost-only defaults.

Set these in `.env` and restart `web`:

```
ALLOWED_HOSTS=localhost,127.0.0.1,192.168.1.x
VITE_SERVER_HOST=192.168.1.x
```

Then browse to `http://192.168.1.x:8000` on the same Wi-Fi.

`VITE_SERVER_HOST` is the host the *browser* fetches dev assets from, so it has to be resolvable by the client. Left at its `localhost` default, a phone resolves it to itself and every module 404s — the page loads and renders blank, with nothing in the Django log to explain it. Setting it to the LAN IP also points your desktop browser at that address, which works but breaks if the IP changes; set it back to `localhost` when you're done.

Two related notes:

- `vite.config.mjs` sets `server.cors.origin` to Vite's exported `defaultAllowedOrigins` plus `192.168.x.x`. Vite only sends `Access-Control-Allow-Origin` to localhost origins by default, and module scripts are always fetched in CORS mode, so without this the LAN page is blank for the same invisible reason. Widen the regex for a `10.x` or `172.16–31.x` network.
- A LAN IP is not a secure origin, so `navigator.serviceWorker.register` is unavailable and there is no PWA install to test this way. That needs TLS.

Because all of this lives in `.env`, which is gitignored, the setup is not reproducible from a clone — the committed defaults are localhost-only.
