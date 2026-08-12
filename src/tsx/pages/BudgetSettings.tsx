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
import { cn } from "@/lib/utils";

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

const VALID_TABS = ["budget", "categories", "pay-schedule", "recurring", "payment-methods"] as const;
type Tab = (typeof VALID_TABS)[number];

const TAB_LABELS: Record<Tab, string> = {
  budget: "Budget",
  categories: "Categories",
  "pay-schedule": "Pay Schedule",
  recurring: "Recurring Transactions",
  "payment-methods": "Payment Methods",
};

/**
 * Below `md` the five tabs are swapped for a native select — the folder strip clips at phone width,
 * and `scrollbar-none` leaves no hint that the last two tabs are off-screen. Mounting only one of the
 * two controls (rather than hiding one with CSS) keeps the product tour from highlighting a hidden tab.
 */
function useIsCompact(): boolean {
  const [compact, setCompact] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const onChange = () => setCompact(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return compact;
}

/**
 * Where the pre-consolidation tab names now live, so an old bookmark still lands on the content
 * it was pointing at rather than silently falling back to the Budget tab.
 */
const LEGACY_TABS: Record<string, Tab> = {
  expense: "categories",
  income: "categories",
  members: "budget",
};

function normalizeTab(value: string | null): Tab {
  if (!value) return "budget";
  if ((VALID_TABS as readonly string[]).includes(value)) return value as Tab;
  return LEGACY_TABS[value] ?? "budget";
}

function readTabFromUrl(): Tab {
  if (typeof window === "undefined") return "budget";
  return normalizeTab(new URL(window.location.href).searchParams.get("tab"));
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
  const isCompact = useIsCompact();
  const [tab, setTab] = useState<Tab>(readTabFromUrl());
  const [budget, setBudget] = useState(initialBudget);
  const [categories, setCategories] = useState(initialCategories);
  const [paymentMethods, setPaymentMethods] = useState(initialPaymentMethods);
  const [memberships, setMemberships] = useState(initialMemberships);
  const [recurring, setRecurring] = useState(initialRecurring);

  const changeTab = useCallback((next: string) => {
    const t = normalizeTab(next);
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
          <h1 className="sr-only">Budget Settings</h1>
          <p className="text-sm text-muted-foreground">{budget.name || "This budget"}</p>
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
        {isCompact ? (
          <div data-tour="settings-tabs">
            <label htmlFor="settings-tab-select" className="sr-only">
              Settings section
            </label>
            {/* A native select rather than the Radix one: this only renders below md, where the
                platform picker is the better control. Styled to match Input rather than reusing it,
                since Input renders an input element. */}
            <select
              id="settings-tab-select"
              value={tab}
              onChange={(e) => changeTab(e.target.value)}
              className={cn(
                "h-11 w-full rounded-md border border-input bg-card px-3 py-1 font-medium text-base shadow-xs md:text-sm dark:bg-input/30",
                "outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
              )}
            >
              {VALID_TABS.map((value) => (
                <option key={value} value={value}>
                  {TAB_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <TabsList variant="folder" className="w-full justify-start" data-tour="settings-tabs">
            {VALID_TABS.map((value) => (
              <TabsTrigger key={value} value={value} data-tour={`tab-${value}`}>
                {TAB_LABELS[value]}
              </TabsTrigger>
            ))}
          </TabsList>
        )}

        <TabsContent value="budget" className="mt-2">
          <BudgetPanel budget={budget} onChange={setBudget}>
            {budget.is_owner && (
              <MembersPanel
                budgetPk={budget_pk}
                memberships={memberships}
                roleChoices={role_choices}
                onChange={setMemberships}
              />
            )}
          </BudgetPanel>
        </TabsContent>

        {/* Income first: money arrives before it is assigned anywhere. */}
        <TabsContent value="categories" className="mt-2">
          <div className="flex flex-col gap-10">
            <CategoriesPanel
              budgetPk={budget_pk}
              type="income"
              categories={categories}
              onCategoriesChange={setCategories}
            />
            <CategoriesPanel
              budgetPk={budget_pk}
              type="expense"
              categories={categories}
              onCategoriesChange={setCategories}
            />
          </div>
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

        <TabsContent value="payment-methods" className="mt-2">
          <PaymentMethodsPanel
            budgetPk={budget_pk}
            paymentMethods={paymentMethods}
            typeChoices={payment_method_type_choices}
            onChange={setPaymentMethods}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
