# Budgeteer

A personal budgeting app built with Django, Inertia.js, and React. Track transactions, manage recurring expenses, set category budgets, and share budgets with other members.

## Tech Stack

**Backend:** Django 6, PostgreSQL, Celery, Redis, Django Allauth, Gunicorn  
**Frontend:** React, Inertia.js, Tailwind CSS v4, Vite, TypeScript  
**Infrastructure:** Docker, Just

## Requirements

- [Docker](https://docs.docker.com/engine/installation/) with Docker Compose
- [Just](https://github.com/casey/just#installation)

## Getting Started

```bash
# 1. Generate the .env file from .env.toml
just create_env

# 2. Start the stack (the web container auto-runs migrations on boot)
just start

# 3. Create a superuser
docker compose exec web python manage.py createsuperuser
```

The app will be available at **http://localhost:8000**.  
Mailpit (email previews) is at **http://localhost:8025**.

## Development Commands

```bash
just start              # Start Docker Compose
just stop               # Stop all services
just build              # Rebuild images and collect static files
just format             # Format Python, JS/TS, CSS, and HTML
just lint               # Lint and type-check everything
just test               # Run the test suite
just pre_commit         # Format + lint + test
just build_frontend     # Build Vite assets
```

Run a single test:
```bash
docker compose exec web pytest --ds=config.settings.test_runner path/to/test.py::TestClass::test_method
```

Budgeteer is a personal, self-hosted app — one owner managing their own money — not a multi-tenant SaaS.

## Features

- **Budgets** — create multiple budgets, invite members, assign owner/member roles
- **Transactions** — log income, expense, and transfer transactions with line-item categorization
- **Categories** — define income/expense categories with monthly spend targets
- **Goals** — save toward one-time or ongoing targets, with monthly-needed math and progress tracking
- **Recurring transactions** — schedule monthly, every-N-months, or annual transactions that auto-generate instances
- **SimpleFIN bank sync** — pull posted bank transactions from linked accounts, reconcile them against your ledger with suggested matches
- **Investments** — track holdings pulled from SimpleFIN-capable accounts (shares, cost basis, market value)
- **Multi-currency** — per-transaction currency with USD conversion at transaction time; per-user display currency
- **Payment methods** — track cards and accounts per budget
- **Budget history** — browse past months across all budgets
- **Account settings** — name, password, and email management (add, verify, set primary)
- **Dark mode** — system-aware theme with manual override
