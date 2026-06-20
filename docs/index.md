---
title: Overview
---

# Budgeteer

A self-hosted personal budgeting app built on Django, Inertia.js, and React.
Aimed at envelope-style budgeting with first-class support for goals, recurring
transactions, and bank-feed reconciliation via SimpleFIN.

## Where to start

- **[Architecture](architecture.md)** — Request lifecycle, Inertia pattern, layout system, and the budget-permission mixins.
- **[Models](models.md)** — The Django domain model: Budgets, Categories, Transactions, Goals, RecurringTransactions, and SimpleFIN-linked BankAccounts.
- **[Database](database.md)** — ER diagram and table-level reference.
- **[Feature Roadmap](feature_roadmap.md)** — Landscape research, ranked feature gaps, and the phased build plan.
- **[Debugging](debugging.md)** — Running locally, inspecting state, and common pitfalls.
- **[Changelog](changelog.md)** — Notable changes by release.

## Building these docs

These docs are built with [Zensical](https://zensical.org/).

```bash
just docs          # Serve locally at http://localhost:4000
just docs_build    # Build the static site into docs_site/
```

Or run the underlying commands directly:

```bash
uv run zensical serve -f zensical.toml
uv run zensical build -f zensical.toml --clean
```
