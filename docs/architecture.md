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
        return inertia_render(request, "Transactions", {
            "budget_pk": self.budget.pk,
            "transactions": lambda: [...],  # lambdas evaluated lazily
        })
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
  scss/
    main.scss               # Bootstrap import, design tokens, global overrides
    _main_nav.scss          # Sidebar layout and styles
    _color_mode_picker.scss # ThemeToggle button + spin animation
  tsx/
    main.tsx                # Inertia bootstrap, default layout assignment
    layouts/
      AppLayout.tsx         # Persistent sidebar, user dropdown, SPA logout
      AuthLayout.tsx        # Centered card for auth pages
    pages/                  # One file per Inertia page (name = component name)
    components/
      ThemeToggle.tsx       # Light/dark/auto cycle with spin animation
      TransactionModal.tsx  # Shared create/edit transaction modal
      LoadingSpinner.tsx
```

## Theme System

- Bootstrap 5 CSS variables are overridden in `src/scss/main.scss` using `:root` and `[data-bs-theme="dark"]` selectors
- The `data-bs-theme` attribute is set on `<html>` by an inline script in `apps/base/templates/app.html` that reads from `localStorage` **before CSS loads**, preventing flash of unstyled content
- `ThemeToggle` cycles auto → light → dark → auto, persisting to `localStorage`

## Apps

| App | Responsibility |
|-----|---------------|
| `apps/accounts/` | Custom `User` model, Allauth adapter, auth views, account settings view |
| `apps/base/` | `InertiaShareMiddleware`, Vite template tags (`{% vite_asset %}`), storage backend |
| `apps/budget/` | All budget domain: models, views, serializers (`data.py`), migrations |

## Configuration

Settings are split across `config/settings/`:
- `_base.py` — shared settings
- `local.py` — development overrides
- `production.py` — production overrides
- `test_runner.py` — test overrides

Environment variables are declared in `pyproject.toml` under `[tool.epicenv.variables]` and loaded from `.env` via epicenv.
