# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Budgeteer is a Django 5 web application built on the Django Base Site template. It uses a custom user model, Celery for background tasks, and Django Allauth for authentication. All development tasks run inside Docker via Just.

## Architecture

- **Apps Structure**: Located in `apps/` directory with `accounts/` (custom user model) and `base/` (core utilities)
- **Configuration**: Settings split into modules in `config/settings/` with environment-based configuration via epicenv (schema defined in pyproject.toml)
- **Frontend**: Vite-based build system with Bootstrap 5, assets in `src/` directory
- **Docker**: Multi-stage production Dockerfile with development compose setup using Docker Desktop
- **Static Files**: Custom storage backend in `apps/base/storage.py`, collected to `collected_static/`

## Development Commands

All commands run inside Docker containers by default. Override with `PYTHON_CMD_PREFIX` / `NODE_CMD_PREFIX` env vars to run locally.

**Setup & Management:**
- `just start` - Start Docker Compose environment
- `just start_full` - Start with full profile (includes docs server)
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
- `just upgrade_all_packages` - Upgrade both, rebuild, and run pre-commit

## Testing

- pytest + pytest-django; settings module: `config.settings.test_runner`
- Model Bakery for fixture-free test data; Django Test Plus for extra helpers
- Coverage config: `config/coverage.ini`

## Code Standards

- **Python**: Formatted with Ruff, type-checked with ty, follows Django conventions
- **JavaScript**: ESLint with Airbnb base config
- **SASS/CSS**: Stylelint with standard SCSS + recess order
- **HTML**: djLint; 120-char line length, 2-space indent

## Debugging

The project supports remote debugging with VS Code, LazyVim/Neovim, or any DAP-compatible editor.

**Quick Start:**
1. Start with debugging: `just start_with_debugpy`
2. Wait for "Debugger listening on 0.0.0.0:5678"
3. Attach your debugger (see below for editor-specific instructions)

**Important:** Auto-reload is disabled when debugging. You must manually restart the server after code changes. Use `just start` for normal development with auto-reload.

**VS Code:**

1. Run: `just start_with_debugpy`
2. Press F5 or select "Django: Attach Debugger" from debug dropdown
3. Set breakpoints and debug your code

VS Code tasks are also available via Command Palette for convenience.

**PyCharm:**
1. Configure Docker Compose Python interpreter (Settings → Python Interpreter)
2. Create Django Server run configuration
3. Click Debug button - PyCharm handles everything automatically
4. See [docs/debugging.md](docs/debugging.md) for detailed setup

**LazyVim/Neovim:**
- Configure nvim-dap to connect to `localhost:5678`
- The debugger uses the standard Debug Adapter Protocol (DAP)
- See [docs/debugging.md](docs/debugging.md) for full configuration

**Notes:**
- Debugger listens on port 5678
- Use `just stop` then `just start` to switch back to normal mode
- PyCharm uses native Docker Compose debugging (doesn't require debugpy)

## Environment Configuration

Uses `.env` file for local development. Environment variable schema is defined in `pyproject.toml` under `[tool.epicenv.variables]`.

Generate a new `.env` file with `just create_env` (uses epicenv).

Key variables:
- `DEBUG=on` for development
- `SECRET_KEY` - Django secret key (auto-generated)
- `DATABASE_URL` - PostgreSQL connection string
- `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB`
- `INTERNAL_IPS` - For Django Debug Toolbar
- `USE_DEBUGPY=true` - Enable remote debugging (optional)

## Key Dependencies

- **Backend**: Django 5, Celery, Redis, PostgreSQL, Django Allauth, Crispy Forms, django-alive (health checks), django-maintenance-mode
- **Frontend**: Vite, Bootstrap 5, SASS
- **Development**: Docker, pytest, Ruff, ty, ESLint, Stylelint
