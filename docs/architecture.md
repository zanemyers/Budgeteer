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

Frontend tool configs (`vite.config.mjs`, `tsconfig.json`, `biome.json`) live at the repo root. Biome handles linting and formatting for JS/TS *and* CSS — its CSS parser has `tailwindDirectives: true` so Tailwind v4 at-rules (`@import "tailwindcss"`, `@custom-variant`, `@theme`, `@apply`, etc.) parse cleanly.

## Theme System

- `src/css/main.css` starts with `@import "tailwindcss"` and a `@custom-variant dark (&:where(.dark, .dark *))` declaration, then defines Bootstrap-shaped utility classes (`.btn`, `.card`, `.form-control`, etc.) consumed by JSX.
- An inline script in `apps/base/templates/layouts/base.html` reads `localStorage.getItem("theme")` and toggles a `dark` class on `<html>` **before CSS loads**, preventing flash of unstyled content.
- `ThemeToggle` cycles auto → light → dark → auto, persisting to `localStorage`.

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
