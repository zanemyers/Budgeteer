# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Budgeteer is a Django 5 + Inertia.js + React SPA. The backend serves data via `inertia_render()`; the frontend is a persistent React app with no full-page reloads. Authentication is handled by Django Allauth with all views overridden to return Inertia responses.

## Development Commands

All commands run inside Docker containers by default. Override with `PYTHON_CMD_PREFIX` / `NODE_CMD_PREFIX` env vars to run locally.

**Setup & Management:**
- `just start` - Start Docker Compose environment
- `just build` - Build Docker images and collect static files
- `just stop` - Stop all services
- `just clean` - Remove build artifacts, caches, coverage data

**Code Quality:**
- `just format` - Format all code (Python with Ruff, JS with ESLint, SASS with Stylelint, HTML with djLint)
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
        return inertia_render(request, "MyPage", {
            "budget_pk": self.budget.pk,
            "items": lambda: [...],  # lambdas are evaluated lazily
        })
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

### Allauth Override Pattern

Auth views in `apps/accounts/views.py` use `InertiaAllauthMixin` to intercept allauth's `render_to_response`. GET requests and POST errors return Inertia responses; POST successes do an `HttpResponseRedirect` (bypassing the override). Custom auth views are registered **before** `include("allauth.urls")` in `config/urls.py` to take precedence.

Frontend auth forms POST with `Content-Type: application/x-www-form-urlencoded` + `X-Requested-With: XMLHttpRequest`. On `res.redirected`, call `router.visit(res.url)`.

### API Pattern for React Components

Non-page React components (modals, inline forms) communicate with the backend via `fetch`. All mutating requests send `X-CSRFToken` from `document.cookie`. Views return `JsonResponse`. GET requests that return a full page use `inertia_render`; API-only endpoints return `JsonResponse` directly.

### Frontend Structure

```
src/tsx/
  main.tsx              # Inertia app bootstrap, assigns AppLayout as default
  layouts/              # AppLayout, AuthLayout
  pages/                # One file per Inertia component (name must match Django view arg)
  components/           # Shared components: ThemeToggle, TransactionModal, LoadingSpinner
src/scss/
  main.scss             # Design tokens (CSS vars), Bootstrap import, global styles
  _main_nav.scss        # Sidebar styles
  _color_mode_picker.scss # Theme toggle styles + spin animation
```

Bootstrap 5 CSS variables are overridden in `src/scss/main.scss`. Dark mode tokens are in `[data-bs-theme="dark"]`. The `data-bs-theme` attribute is set on `<html>` by an inline script in `app.html` (reads from `localStorage`) before CSS loads to prevent FOUC.

### Apps Structure

- **`apps/accounts/`** — custom user model, Allauth adapter, auth views, account settings
- **`apps/base/`** — `InertiaShareMiddleware`, Vite template tags, base views, storage backend
- **`apps/budget/`** — all budget domain logic: models, views, data serializers, migrations

`apps/budget/data.py` contains all serializer functions (`serialize_transaction`, `serialize_payment_method`, etc.) used by views to build Inertia props.

### Configuration

Settings are split in `config/settings/` (base, local, production, test_runner). Environment variables are defined in `pyproject.toml` under `[tool.epicenv.variables]` and loaded from `.env` via epicenv. Generate a fresh `.env` with `just create_env`.

## Testing

- pytest + pytest-django; settings module: `config.settings.test_runner`
- Model Bakery for fixture-free test data; Django Test Plus for extra helpers
- Coverage config: `config/coverage.ini`

## Code Standards

- **Python**: Ruff (format + lint), type-checked with ty
- **JavaScript/TypeScript**: ESLint with Airbnb base config
- **SASS/CSS**: Stylelint with standard SCSS + recess property order
- **HTML**: djLint; 120-char line length, 2-space indent
