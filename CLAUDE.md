# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Budgeteer is a Django 6 + Inertia.js + React SPA, styled with Tailwind CSS v4. The backend serves data via `inertia_render()`; the frontend is a persistent React app with no full-page reloads. Authentication is handled by Django Allauth with all views overridden to return Inertia responses.

## Development Commands

All commands run inside Docker containers by default. Override with `PYTHON_CMD_PREFIX` / `NODE_CMD_PREFIX` env vars to run locally.

**Setup & Management:**
- `just start` - Start Docker Compose environment
- `just build` - Build Docker images and collect static files
- `just stop` - Stop all services
- `just clean` - Remove build artifacts, caches, coverage data

**Code Quality:**
- `just format` - Format all code (Python with Ruff, JS/TS with ESLint, HTML with djLint). Note: `format_sass` / `lint_sass` targets in `config/base.just` are vestigial — there is no SCSS in the project anymore.
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
src/config/
  vite.config.mjs       # Vite config; entries are css/main.css and tsx/main.tsx
```

Styling uses Tailwind CSS v4 via `@tailwindcss/vite`. `src/css/main.css` starts with `@import "tailwindcss"` and a `@custom-variant dark (&:where(.dark, .dark *))` declaration, then defines a set of Bootstrap-shaped utility classes (`.btn`, `.btn-primary`, `.card`, `.form-control`, `.table`, `.modal`, `.sidebar`, etc.) that the JSX consumes. When adding new UI, prefer Tailwind utilities directly; only extend `main.css` if you need a class that's reused across many components.

Dark mode is class-based: an inline script in `apps/base/templates/layouts/base.html` reads `localStorage.getItem("theme")` and toggles a `dark` class on `<html>` before CSS loads (prevents FOUC). `ThemeToggle.tsx` cycles auto → light → dark and persists to `localStorage`.

### Apps Structure

- **`apps/accounts/`** — custom user model, Allauth adapter, auth views, account settings
- **`apps/base/`** — `InertiaShareMiddleware`, Vite template tags, base views, storage backend
- **`apps/budget/`** — all budget domain logic: models, views, data serializers, migrations

`apps/budget/data.py` contains all serializer functions (`serialize_transaction`, `serialize_payment_method`, etc.) used by views to build Inertia props.

### Configuration

Settings are split in `config/settings/` (base, local, production, test_runner). Environment variables are defined in `pyproject.toml` under `[tool.epicenv.variables]` and loaded from `.env` via epicenv. Generate a fresh `.env` with `just create_env`.

## Testing

- pytest + pytest-django; settings module: `config.settings.test_runner`
- `model-bakery` and `django-test-plus` are installed (dev deps) but not yet adopted in the suite
- Coverage config: `config/coverage.ini`

## Code Standards

- **Python**: Ruff (format + lint), type-checked with ty; 120-char line length
- **JavaScript/TypeScript**: ESLint (config in `src/config/eslint.config.js`); npm scripts call `bunx` (project switched from npm to bun)
- **CSS**: Tailwind v4; no Stylelint, no SCSS
- **HTML**: djLint; 120-char line length, 2-space indent
