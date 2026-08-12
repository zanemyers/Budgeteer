# CHANGELOG

## 2026-08-12

### Removed

* **Transfers (two-leg pairing)** — retired the whole feature added on 2026-07-23. Gone: `Transaction.transfer_partner` and its column, `link_transfer()` / `unlink_transfer()`, `Category.get_or_create_transfers()`, the three candidate-matching helpers in `data.py` (`find_transfer_candidates`, `find_pending_bank_transfer_candidates`, `find_transfer_candidates_for_bank_txn`), the `TransferCandidatesView` / `TransferLinkView` / `BankTransactionConfirmAsTransferView` views and their three routes, the `is_transfer` and `transfer_partner_id` serializer fields, and all user-facing "transfer" wording. An account-to-account movement is handled by **ignoring the bank row** instead — simpler, and nothing has to be kept in step.
* Migrations: `0002_retire_transfer_pairs` unpairs every row, deleting bank-backed legs and returning their bank rows to `pending` (the bank row still carries date, payee, amount and memo, so nothing is lost) while leaving hand-entered legs in place; `0003_drop_transfer_partner` removes the field.

### Changed

* `transaction_type="transfer"` **stays**, now meaning exactly one thing: a goal deposit. The ready-to-assign and goal-balance sums in `data.py` still exclude it, so money moved into a goal reads as neither income nor spending. The Transactions page badge reads **Goal** rather than Transfer, and the goal modal is titled "Deposit to Goal".
* `test_transfers.py` replaced by `test_goal_deposits_do_not_distort_totals.py`, covering the invariant that outlived the feature.

## 2026-07-23

### Added

* **Transfers** — first-class account-to-account movements. A new `transfer_partner` 1:1 self-FK on `Transaction` links two legs; both are excluded from headline income/expense totals. A hidden per-budget "Transfers" category (`Category.is_system=True`, `Category.get_or_create_transfers()`) holds the placeholder line. New `BankTransactionConfirmAsTransferView` lets you confirm a bank row against another pending bank row or an existing transaction, creating and linking the pair. Transactions page adds a **Transfers** tab; frontend uses a computed `is_transfer` serializer flag that folds in three signals (`transaction_type == "transfer"`, `transfer_partner` set, or any line in a system category) so orphan/legacy transfers no longer leak into the Logged tab.
* `jsonFetch` now surfaces expired-session redirects (`/accounts/login/`) as a structured `{ error, status: 401 }` throw instead of a confusing `SyntaxError`.

### Fixed

* `AssignModal` batch-assign now uses `jsonFetch` (throws on non-2xx) instead of raw `Promise.all(fetch(...))`, which silently accepted 4xx/5xx as success and left partial assignments unsaved.
* Every mutation in `Transactions.tsx` (`saveDesc`, `saveDate`, `savePM`, `markPaid`, `deleteTxn`, `restoreBankTxn`, `ignoreBankTxn`, `ignoreLinkedBankTxn`, `saveIgnoreReason`) is now wrapped in `try/catch` with a `sonner` toast on failure. Previously errors were silently swallowed.
* Confirming a bank row as a transfer against another pending bank row now removes **both** rows from the Pending list immediately (was leaving the partner behind until page refresh).

### Changed

* Retired the leftover MkDocs stack (`config/mkdocs.yml`, `lint_docs` recipe, four direct + ~20 transitive deps). Zensical is now the sole docs generator.
* Deleted four empty scaffold apps (`apps/billing/`, `apps/notifications/`, `apps/organizations/`, `apps/teams/`) — never in `INSTALLED_APPS`, never imported.
* CLAUDE.md, README.md, and the docs site now correctly reflect the current apps list (`accounts, base, budget, banking, investments`), settings modules (`_base.py`, `test_runner.py`), and toolchain (Biome for JS/TS/CSS, not ESLint/Stylelint).


## 2026-06-20

### Changed

* Moved the epicenv schema out of `pyproject.toml` into `.env.toml` at the repo root. Each variable is now a readable `[variables.NAME]` TOML table. Pinned `epicenv[django]~=1.6`.
* Added the **Investments** page and an `apps/investments/` app that persists SimpleFIN holdings.
* Set up [Zensical](https://zensical.org/) for these docs. Serve locally via `just docs` (also starts as a Docker service alongside `just start`).
* Moved Banking and Investments into the sidebar; relabeled the budget section as **Budgets**.
* Transactions list now defaults to newest-first; tabs reordered to Pending → Logged → Ignored.
* Dashboard "Ready to Assign" banner is hidden once every dollar is assigned.
* Surface 429 rate limits and other errors as toasts when resending verification emails or changing the primary email. Backend rate-limit added to the resend endpoint.

### Added

* `Goal` model (replaces `SinkingFund`) with its own page and modal.


## 2026-03-05

### Added

* Added [Mailpit](https://mailpit.axllent.org/) for local email capture with a web UI at http://localhost:8025
* Changed `ACCOUNT_EMAIL_VERIFICATION` from `"none"` to `"optional"` now that local email delivery works via Mailpit


## 2026-01-25

### Changed

* Upgraded epicenv to v1.2 and switched to using the built-in `epicenv.initializers.url_safe_password` function for generating `SECRET_KEY` and `POSTGRES_PASSWORD`


## 2026-01-24

### Added

* Added support for remote debugging with VS Code, PyCharm, and LazyVim/Neovim
* Added debugpy as a development dependency for Python debugging
* Added `just create_env` command for .env file generation with backup support
* Added comprehensive debugging documentation in docs/debugging.md
* Added debugging support section to README

### Changed

* Modernized navbar with offcanvas menu and improved mobile UX
* Improved VS Code debugging workflow with simplified two-step process
* Refactored ENABLE_DEBUGGER to USE_DEBUGPY for consistency
* Refactored .env creation into separate script with backup support
* Bumped uv-dependencies group with 7 updates
* Bumped development-dependencies group with 2 updates
* Bumped Node from 25.3 to 25.4

### Fixed

* Fixed jumbotron button overflow on mobile devices


## 2025-12-19

### Changed

* Switched from MyPy to Ty for Python type checking. Ty is a fast, modern type checker from Astral that provides significantly better performance than MyPy.


