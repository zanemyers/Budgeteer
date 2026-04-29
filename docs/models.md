# Data Models

All budget domain models live in `apps/budget/models.py`. The user model is in `apps/accounts/models.py`.

## Entity Relationships

```
User (accounts)
 ├── Budget (via BudgetMembership, M2M)
 └── allauth EmailAddress (M2M via allauth)

Budget
 ├── BudgetMembership  (role: owner | member)
 ├── Category          (income | expense)
 ├── CategoryBudget    (monthly assigned amount per category)
 ├── PaymentMethod     (per-budget cards/accounts)
 ├── RecurringTransaction
 └── Transaction
      └── TransactionLine  (one per category, splits a transaction)
```

## Models

### User
Custom `AbstractUser` in `apps/accounts/models.py`. Adds `_get_gravatar_url()` and a `gravatar` property that returns an `<img>` tag. Email is the login identifier (`ACCOUNT_LOGIN_METHODS = {"email"}`).

### Budget
Top-level container. Has a `name` (optional) and a `created_by` FK. Members are linked through `BudgetMembership`. `__str__` lists the first three member names/emails.

### BudgetMembership
Through table for `Budget.members`. Roles: `owner` or `member`. Owners can rename/delete the budget, manage members, and perform other destructive actions.

### Category
Belongs to a budget. `category_type` is `income` or `expense`. `monthly_budget` is a default target that can be overridden per-month via `CategoryBudget`. `(budget, name, category_type)` is unique together.

### CategoryBudget
Stores the *assigned* monthly spend target for a specific category in a specific month. `month` is always the first day of the month. Used to build the budget overview on the dashboard.

### PaymentMethod
Belongs to a `Budget` (not a user). Tracks name, type (`credit_card`, `debit_card`, `cash`, `bank_transfer`, `other`), last four digits, and active status.

### RecurringTransaction
A schedule template that auto-generates `Transaction` instances. Key fields:
- `frequency`: `monthly`, `every_n_months`, `annually`
- `interval`: number of months between occurrences (used when `frequency=every_n_months`)
- `start_date` / `end_date`: bounds for instance generation
- `generated_through`: tracks how far ahead instances have been created

`generate_instances_up_to(through_date)` creates `Transaction` instances up to the given date and updates `generated_through`. Called on create/edit and by a background task.

### Transaction
A single financial event. Belongs to a `Budget`. May reference a `RecurringTransaction` (if auto-generated). `total_amount` is the sum of all `TransactionLine` amounts (or inherited from the recurring template if no lines exist). `transaction_type` is derived from the first line's category type.

### TransactionLine
A line item on a `Transaction`. Each line references a `Category` and has an `amount`. Transactions can be split across multiple categories (e.g. a grocery store receipt split between Food and Household).

## Key Invariants

- A transaction's lines must all be the same `category_type` (all income or all expense)
- `PaymentMethod` belongs to a budget, not a user — payment methods are shared among budget members
- A `Category` cannot be deleted if it has `TransactionLine` records referencing it (`PROTECT`)
- `RecurringTransaction.payment_method` and `Transaction.payment_method` are nullable (`SET_NULL`) — deleting a payment method doesn't cascade to transactions
