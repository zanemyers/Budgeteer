export interface Category {
  id: number;
  name: string;
  category_type: "income" | "expense";
  monthly_budget: string;
  is_sinking_fund: boolean;
  sinking_fund_target: string | null;
  sinking_fund_due_date: string | null;
  sinking_fund_ongoing: boolean;
  sinking_fund_monthly_goal: string | null;
}

export interface TransactionLine {
  id?: number;
  category: number;
  category_name?: string;
  category_type?: "income" | "expense";
  amount: string;
  description: string;
}

export interface PaymentMethod {
  id: number;
  name: string;
  payment_type: "credit_card" | "debit_card" | "cash" | "bank_transfer" | "direct_deposit" | "other";
  payment_type_display: string;
  last_four: string;
  is_active: boolean;
}

export interface Transaction {
  id: number;
  description: string;
  due_date: string;
  paid_date: string | null;
  is_paid: boolean;
  notes: string;
  recurring: number | null;
  payment_method: number | null;
  payment_method_name: string | null;
  lines: TransactionLine[];
  total_amount: string;
  transaction_type: "income" | "expense" | "transfer" | "";
  currency: string;
  exchange_rate_to_usd: string;
  created_at: string;
  bank_linked?: boolean;
  linked_bank_transactions?: LinkedBankTransaction[];
}

export interface LinkedBankTransaction {
  id: number;
  posted_date: string;
  amount: string;
  description: string;
  payee: string;
  memo: string;
  bank_account_name: string;
  org_name: string;
}

export interface CurrencyOption {
  code: string;
  name: string;
  symbol: string;
}

export interface BudgetMember {
  id: number;
  user: number;
  email: string;
  name: string;
  role: "owner" | "member";
  gravatar_url: string;
  joined_at: string;
}

export interface Budget {
  id: number;
  members: BudgetMember[];
  created_at: string;
}

export interface BankTransaction {
  id: number;
  posted_date: string;
  amount: string;
  description: string;
  payee: string;
  memo: string;
  status: "pending" | "linked" | "ignored";
  ignore_reason?: string;
  transaction_id: number | null;
  bank_account_id: number;
  bank_account_name: string;
  org_name: string;
}

export interface BankMatchSuggestion {
  kind: "transaction" | "recurring" | "paid_transaction" | "merchant_rule";
  confidence: number;
  label: string;
  sublabel: string;
  transaction_id: number | null;
  category_id: number | null;
  category_name: string | null;
  payment_method_id: number | null;
}

export interface RecurringTransaction {
  id: number;
  name: string;
  description: string;
  amount: string;
  category: number;
  category_name?: string;
  category_type?: "income" | "expense";
  frequency: string;
  interval: number;
  start_date: string;
  end_date: string | null;
  is_active: boolean;
  generated_through: string | null;
  next_due_date: string | null;
  created_at: string;
}

export interface CategoryBudget {
  id: number;
  category: number;
  month: string;
  assigned: string;
}

export interface BudgetOverviewCategory {
  id: number;
  name: string;
  category_type: "income" | "expense";
  parent_id: number | null;
  budgeted: string;
  assigned: string;
  activity: string;
  available: string;
  is_sinking_fund: boolean;
  sinking_fund_target: string | null;
  sinking_fund_due_date: string | null;
  sinking_fund_ongoing: boolean;
  sinking_fund_monthly: string | null;
  sinking_fund_monthly_goal: string | null;
  sinking_fund_months_remaining: number | null;
  sinking_fund_total_saved: string | null;
  sinking_fund_total_credited: string | null;
}

export interface BudgetOverview {
  ready_to_assign: string;
  income_total: string;
  expense_assigned: string;
  transfers_total: string;
  sf_monthly_spending: string;
  categories: BudgetOverviewCategory[];
}

export interface ApiError {
  [key: string]: string[];
}
