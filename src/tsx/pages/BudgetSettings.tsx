import { router } from "@inertiajs/react";
import { useCallback, useEffect, useState } from "react";
import { PageTourButton } from "@/components/PageTourButton";
import { BudgetPanel, type BudgetSummary } from "@/components/settings/BudgetPanel";
import { CategoriesPanel, type CategoryType } from "@/components/settings/CategoriesPanel";
import { type Membership, MembersPanel } from "@/components/settings/MembersPanel";
import { type PaymentMethod, PaymentMethodsPanel } from "@/components/settings/PaymentMethodsPanel";
import { type PaySchedule, PaySchedulePanel } from "@/components/settings/PaySchedulePanel";
import type { RecurringFormChoice } from "@/components/settings/RecurringFormModal";
import { RecurringPanel, type RecurringPanelItem } from "@/components/settings/RecurringPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SELECT_TAB_EVENT, usePageTour } from "@/lib/onboardingTour";

interface TypeChoice {
  value: string;
  label: string;
}

interface Props {
  budget_pk: number;
  budget: BudgetSummary;
  categories: CategoryType[];
  category_type_choices: TypeChoice[];
  payment_methods: PaymentMethod[];
  payment_method_type_choices: TypeChoice[];
  memberships: Membership[];
  role_choices: TypeChoice[];
  recurring: RecurringPanelItem[];
  freq_choices: RecurringFormChoice[];
  pay_schedules: PaySchedule[];
  pay_schedule_freq_choices: { value: string; label: string }[];
}

const VALID_TABS = ["budget", "pay-schedule", "expense", "income", "payment-methods", "recurring", "members"] as const;
type Tab = (typeof VALID_TABS)[number];

function readTabFromUrl(): Tab {
  if (typeof window === "undefined") return "budget";
  const t = new URL(window.location.href).searchParams.get("tab");
  return (VALID_TABS as readonly string[]).includes(t ?? "") ? (t as Tab) : "budget";
}

export default function BudgetSettings({
  budget_pk,
  budget: initialBudget,
  categories: initialCategories,
  payment_methods: initialPaymentMethods,
  payment_method_type_choices,
  memberships: initialMemberships,
  role_choices,
  recurring: initialRecurring,
  freq_choices,
  pay_schedules,
  pay_schedule_freq_choices,
}: Props) {
  usePageTour("settings", budget_pk);
  const [tab, setTab] = useState<Tab>(readTabFromUrl());
  const [budget, setBudget] = useState(initialBudget);
  const [categories, setCategories] = useState(initialCategories);
  const [paymentMethods, setPaymentMethods] = useState(initialPaymentMethods);
  const [memberships, setMemberships] = useState(initialMemberships);
  const [recurring, setRecurring] = useState(initialRecurring);

  const changeTab = useCallback((next: string) => {
    const t = (VALID_TABS as readonly string[]).includes(next) ? (next as Tab) : "budget";
    setTab(t);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", t);
    window.history.replaceState({}, "", url.toString());
  }, []);

  // The product tour switches tabs by dispatching this event as it highlights each one.
  useEffect(() => {
    const handler = (e: Event) => changeTab((e as CustomEvent<string>).detail);
    window.addEventListener(SELECT_TAB_EVENT, handler);
    return () => window.removeEventListener(SELECT_TAB_EVENT, handler);
  }, [changeTab]);

  return (
    <div className="max-w-4xl flex flex-col flex-1 min-h-0">
      <header className="mb-8 flex justify-between items-start gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Budget Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {budget.name || "This budget"}: categories, payment methods, members.
          </p>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <PageTourButton stage="settings" />
          <a
            href={`/budgets/${budget_pk}/`}
            className="text-sm text-muted-foreground hover:text-foreground"
            onClick={(e) => {
              e.preventDefault();
              router.visit(`/budgets/${budget_pk}/`);
            }}
          >
            ← Back to budget
          </a>
        </div>
      </header>

      <Tabs value={tab} onValueChange={changeTab} className="gap-6 flex-1">
        <TabsList variant="folder" className="w-full justify-start" data-tour="settings-tabs">
          <TabsTrigger value="budget" data-tour="tab-budget">
            Budget
          </TabsTrigger>
          <TabsTrigger value="pay-schedule" data-tour="tab-pay-schedule">
            Pay Schedule
          </TabsTrigger>
          <TabsTrigger value="expense" data-tour="tab-expense">
            Expense Categories
          </TabsTrigger>
          <TabsTrigger value="income" data-tour="tab-income">
            Income Categories
          </TabsTrigger>
          <TabsTrigger value="payment-methods" data-tour="tab-payment-methods">
            Payment Methods
          </TabsTrigger>
          <TabsTrigger value="recurring" data-tour="tab-recurring">
            Recurring Transactions
          </TabsTrigger>
          {budget.is_owner && (
            <TabsTrigger value="members" data-tour="tab-members">
              Members
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="budget" className="mt-2">
          <BudgetPanel budget={budget} onChange={setBudget} />
        </TabsContent>

        <TabsContent value="pay-schedule" className="mt-2">
          <PaySchedulePanel
            budgetPk={budget_pk}
            paySchedules={pay_schedules}
            freqChoices={pay_schedule_freq_choices}
            incomeCategories={categories.filter((c) => c.category_type === "income")}
            paymentMethods={paymentMethods}
            isOwner={budget.is_owner}
          />
        </TabsContent>

        <TabsContent value="expense" className="mt-2">
          <CategoriesPanel
            budgetPk={budget_pk}
            type="expense"
            categories={categories}
            onCategoriesChange={setCategories}
          />
        </TabsContent>

        <TabsContent value="income" className="mt-2">
          <CategoriesPanel
            budgetPk={budget_pk}
            type="income"
            categories={categories}
            onCategoriesChange={setCategories}
          />
        </TabsContent>

        <TabsContent value="payment-methods" className="mt-2">
          <PaymentMethodsPanel
            budgetPk={budget_pk}
            paymentMethods={paymentMethods}
            typeChoices={payment_method_type_choices}
            onChange={setPaymentMethods}
          />
        </TabsContent>

        <TabsContent value="recurring" className="mt-2">
          <RecurringPanel
            budgetPk={budget_pk}
            recurring={recurring}
            categories={categories}
            paymentMethods={paymentMethods}
            freqChoices={freq_choices}
            onChange={setRecurring}
          />
        </TabsContent>

        {budget.is_owner && (
          <TabsContent value="members" className="mt-2">
            <MembersPanel
              budgetPk={budget_pk}
              memberships={memberships}
              roleChoices={role_choices}
              onChange={setMemberships}
            />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
