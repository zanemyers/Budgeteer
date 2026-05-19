# Data Models

Budget domain models live in `apps/budget/models.py`. Banking models (SimpleFIN integration) live in `apps/banking/models.py`. The user model is in `apps/accounts/models.py`. Shared lookup tables (e.g. `Currency`) live in `apps/base/models.py`. See [`database.md`](database.md) for the full ER diagram.

Note: the banking tables retain their original `base_*` table names in Postgres — the move from `apps/base` to `apps/banking` is purely a Django-state shuffle (`db_table` is preserved). New banking models should drop the override.

## Entity Relationships

```
User (accounts)
 ├── Budget (via BudgetMembership, M2M)
 ├── SimpleFINConnection
 └── allauth EmailAddress (M2M via allauth)

Budget
 ├── BudgetMembership   (role: owner | member)
 ├── Category           (income | expense)
 │    └── SinkingFund   (1:1, optional — target / due_date / ongoing / monthly_goal)
 ├── CategoryBudget     (monthly assigned amount per category)
 ├── PaymentMethod      (per-budget cards/accounts)
 ├── RecurringTransaction
 └── Transaction
      ├── TransactionLine    (one per category, splits a transaction)
      └── BankTransaction    (1:1, optional — set when reconciled from a bank sync)

SimpleFINConnection
 └── BankAccount
      ├── PaymentMethod  (FK, optional — maps the account into a budget)
      └── BankTransaction
```

## Models

### User
Custom `AbstractUser` in `apps/accounts/models.py`. Adds `_get_gravatar_url()` and a `gravatar` property that returns an `<img>` tag. Email is the login identifier (`ACCOUNT_LOGIN_METHODS = {"email"}`). `currency` is an ISO code (e.g. `"USD"`).

### Budget
Top-level container. Has a `name` (optional) and a `created_by` FK. Members are linked through `BudgetMembership`. `__str__` lists the first three member names/emails.

### BudgetMembership
Through table for `Budget.members`. Roles: `owner` or `member`. Owners can rename/delete the budget, manage members, and perform other destructive actions.

### Category
Belongs to a budget. `category_type` is `income` or `expense`. `monthly_budget` is a default target that can be overridden per-month via `CategoryBudget`. Self-FK `parent` allows 2-level nesting (parent + subcategory). `(budget, name, category_type)` is unique for root categories; `(parent, name)` is unique for subcategories.

Backwards-compat properties (`is_sinking_fund`, `sinking_fund_target`, `sinking_fund_due_date`, `sinking_fund_ongoing`, `sinking_fund_monthly_goal`) read through to the optional related `SinkingFund` row so existing serializer/template code keeps working.

### SinkingFund
1:1 with `Category`. Present only for categories that are sinking funds — `hasattr(cat, "sinking_fund")` is the canonical check, or `cat.is_sinking_fund` (the property).

Fields: `target` (required), `due_date` (used when not ongoing), `ongoing` (boolean), `monthly_goal` (used when ongoing).

### CategoryBudget
Stores the *assigned* monthly spend target for a specific category in a specific month. `month` is always the first day of the month. Used to build the budget overview on the dashboard.

### PaymentMethod
Belongs to a `Budget` (not a user). Tracks name, `payment_type` (`credit_card`, `debit_card`, `cash`, `bank_transfer`, `direct_deposit`, `other`), last four digits, and active status.

### RecurringTransaction
A schedule template that auto-generates `Transaction` instances. Key fields:
- `frequency`: `monthly`, `every_n_months`, `annually`
- `interval`: number of months between occurrences (used when `frequency=every_n_months`)
- `start_date` / `end_date`: bounds for instance generation
- `generated_through`: tracks how far ahead instances have been created

`generate_instances_up_to(through_date)` creates `Transaction` instances **with a `TransactionLine` per instance** (category and amount copied from the template) and updates `generated_through`. Called on create/edit and by the daily cron job.

### Transaction
A single financial event. Belongs to a `Budget`. May reference a `RecurringTransaction` (if auto-generated). Every Transaction has at least one `TransactionLine` — there are no stub transactions.

- `paid_date` is the single source of truth for paid/unpaid status. `paid_date IS NULL` ⇒ pending/unpaid; otherwise paid.
- `total_amount` is the sum of all `TransactionLine` amounts.
- `transaction_type` is `income`, `expense`, or `transfer`. Stored explicitly because `transfer` (a deposit to a sinking fund from elsewhere in the budget) can't be derived from lines alone.
- `currency` is an ISO code; `exchange_rate_to_usd` snapshots the rate at the time of entry.

### TransactionLine
A line item on a `Transaction`. Each line references a `Category` and has an `amount`. Transactions can be split across multiple categories (e.g. a grocery store receipt split between Food and Household). `amount_usd` is the line's amount converted to USD at the transaction's stored rate.

### Currency
ISO-4217 code table. `code` (PK), `name`, `symbol`, `rate_to_usd`. Refreshed daily by the `update_exchange_rates` management command. Joined by string code from `User.currency`, `Transaction.currency`, and `BankAccount.currency`.

## Banking models (apps/banking)

### SimpleFINConnection
A user's connection to the SimpleFIN Bridge. Stores an encrypted `access_url`. `last_synced_at` records the last sync attempt; `last_sync_error` carries the most recent error message (empty when healthy). The `sync_status` property derives `"pending" | "ok" | "error"` from those two fields — there is no stored status column.

### BankAccount
An account at a financial institution surfaced by a connection. `(connection, simplefin_id)` is unique. Optionally maps to a `PaymentMethod` — that mapping is what brings the account's transactions into a specific budget. `balance` and `balance_as_of` are refreshed on each sync.

### BankTransaction
A single posted transaction from a bank. `(bank_account, simplefin_id)` is unique. Stores the full raw SimpleFIN payload in `raw`. Has a **OneToOne** FK to `Transaction` (`transaction`) — at most one BankTransaction can be linked to a given Transaction, and vice versa. Reverse accessor is the singular `txn.bank_transaction`.

`status` is `pending` (default, awaiting confirm), `linked` (matched to a Transaction), or `ignored` (user dismissed it). `is_pending_at_bank` reflects whether the bank still considers the transaction pending; the sync command currently skips pending-at-bank rows to avoid storing them under ids that may change once they post.

## Key Invariants

- A transaction's lines must all be the same `category_type` (all income or all expense).
- Every `Transaction` has at least one `TransactionLine`. Recurring instances are generated with a synthesized line from the template — there are no line-less stubs.
- `paid_date IS NOT NULL` is the only signal for "paid". There is no separate boolean.
- `PaymentMethod` belongs to a budget, not a user — payment methods are shared among budget members.
- A `Category` cannot be deleted if it has `TransactionLine` records referencing it (`PROTECT`).
- `RecurringTransaction.payment_method` and `Transaction.payment_method` are nullable (`SET_NULL`) — deleting a payment method doesn't cascade to transactions.
- A `BankTransaction` is linked to at most one `Transaction` (OneToOne). Confirming/ignoring a BankTransaction sets its `status` and (for `linked`) the `transaction` FK; the reverse accessor on Transaction is `bank_transaction` (singular).
- `BankAccount.payment_method` is what scopes bank data into a budget. An unmapped account's transactions sit in the connection-level inbox until the user wires it up.
