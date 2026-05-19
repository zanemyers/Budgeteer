from django.urls import path

from apps.budget import views

app_name = "budget"

urlpatterns = [
    # Budget
    path("", views.BudgetListView.as_view(), name="list"),
    # Payment Methods
    path("<int:budget_pk>/payment-methods/", views.PaymentMethodsView.as_view(), name="payment-methods"),
    path("<int:budget_pk>/payment-methods/<int:pk>/", views.PaymentMethodDetailView.as_view(), name="payment-method-detail"),
    path("create/", views.BudgetCreateView.as_view(), name="create"),
    path("<int:budget_pk>/set-default/", views.BudgetSetDefaultView.as_view(), name="set-default"),
    path("<int:budget_pk>/", views.BudgetDetailView.as_view(), name="detail"),
    path("<int:budget_pk>/edit/", views.BudgetUpdateView.as_view(), name="edit"),
    path("<int:budget_pk>/sinking-funds/", views.SinkingFundsView.as_view(), name="sinking-funds"),
    path("<int:budget_pk>/delete/", views.BudgetDeleteView.as_view(), name="delete"),
    path("<int:budget_pk>/settings/", views.BudgetSettingsView.as_view(), name="settings"),
    # Members
    path("<int:budget_pk>/members/invite/", views.MemberInviteView.as_view(), name="member-invite"),
    path("<int:budget_pk>/members/<int:pk>/remove/", views.MemberRemoveView.as_view(), name="member-remove"),
    # Categories
    path("<int:budget_pk>/categories/create/", views.CategoryCreateView.as_view(), name="category-create"),
    path("<int:budget_pk>/categories/<int:pk>/edit/", views.CategoryUpdateView.as_view(), name="category-edit"),
    path("<int:budget_pk>/categories/<int:pk>/delete/", views.CategoryDeleteView.as_view(), name="category-delete"),
    # Category budgets (assigned amounts)
    path("<int:budget_pk>/category-budgets/<int:category_pk>/", views.CategoryBudgetUpdateView.as_view(), name="category-budget-update"),
    # Transactions
    path("<int:budget_pk>/transactions/", views.TransactionListView.as_view(), name="transaction-list"),
    path("<int:budget_pk>/transactions/create/", views.TransactionCreateView.as_view(), name="transaction-create"),
    path("<int:budget_pk>/transactions/<int:pk>/", views.TransactionDetailView.as_view(), name="transaction-detail"),
    path("<int:budget_pk>/transactions/<int:pk>/edit/", views.TransactionUpdateView.as_view(), name="transaction-edit"),
    path("<int:budget_pk>/transactions/<int:pk>/delete/", views.TransactionDeleteView.as_view(), name="transaction-delete"),
    path("<int:budget_pk>/transactions/<int:pk>/mark-paid/", views.TransactionMarkPaidView.as_view(), name="transaction-mark-paid"),
    # Recurring (lives in BudgetSettings; modal endpoints only)
    path("<int:budget_pk>/recurring/create/", views.RecurringCreateView.as_view(), name="recurring-create"),
    path("<int:budget_pk>/recurring/<int:pk>/", views.RecurringDetailView.as_view(), name="recurring-detail"),
    # Bank transactions (SimpleFIN → local reconciliation)
    path("<int:budget_pk>/bank-transactions/", views.BankTransactionListView.as_view(), name="bank-txn-list"),
    path("<int:budget_pk>/bank-transactions/<int:pk>/suggestions/", views.BankTransactionSuggestionsView.as_view(), name="bank-txn-suggestions"),
    path("<int:budget_pk>/bank-transactions/<int:pk>/link/", views.BankTransactionLinkView.as_view(), name="bank-txn-link"),
    path("<int:budget_pk>/bank-transactions/<int:pk>/create-transaction/", views.BankTransactionCreateTxnView.as_view(), name="bank-txn-create"),
    path("<int:budget_pk>/bank-transactions/<int:pk>/ignore/", views.BankTransactionIgnoreView.as_view(), name="bank-txn-ignore"),
    path("<int:budget_pk>/bank-transactions/<int:pk>/unlink/", views.BankTransactionUnlinkView.as_view(), name="bank-txn-unlink"),
]
