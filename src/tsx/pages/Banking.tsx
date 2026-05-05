import { router } from "@inertiajs/react";
import { useState } from "react";

interface Transaction {
  id: string;
  posted: number;
  amount: string;
  description: string;
  payee: string;
  memo: string;
  pending: boolean;
}

interface Account {
  id: string;
  name: string;
  currency: string;
  balance: string;
  available_balance: string | null;
  balance_date: number | null;
  org_name: string;
  org_domain: string;
  transactions: Transaction[];
}

interface Connection {
  id: number;
  label: string;
  accounts: Account[];
  errors: string[];
  fetch_error: string | null;
}

interface Props {
  connections: Connection[];
  days: number;
  fetched_at: number;
}

function fmtMoney(amount: string, currency: string): string {
  const n = Number.parseFloat(amount);
  if (Number.isNaN(n)) return amount;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(n);
  } catch {
    return `${amount} ${currency}`;
  }
}

function fmtDate(unix: number | null): string {
  if (!unix) return "—";
  return new Date(unix * 1000).toLocaleDateString();
}

function AccountCard({ account }: { account: Account }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card mb-3">
      <div className="card-body">
        <div className="flex justify-between items-start gap-4">
          <div>
            <div className="text-muted text-xs uppercase tracking-wide">{account.org_name}</div>
            <div className="font-semibold">{account.name}</div>
            <div className="text-muted text-sm">As of {fmtDate(account.balance_date)}</div>
          </div>
          <div className="text-right">
            <div className="text-xl font-semibold">{fmtMoney(account.balance, account.currency)}</div>
            {account.available_balance && account.available_balance !== account.balance && (
              <div className="text-muted text-sm">Avail. {fmtMoney(account.available_balance, account.currency)}</div>
            )}
          </div>
        </div>

        {account.transactions.length > 0 && (
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary mt-3"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? "Hide" : "Show"} {account.transactions.length} transaction{account.transactions.length === 1 ? "" : "s"}
          </button>
        )}

        {open && (
          <div className="table-responsive mt-3">
            <table className="table table-sm mb-0">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Payee</th>
                  <th>Description</th>
                  <th className="text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {account.transactions
                  .slice()
                  .sort((a, b) => b.posted - a.posted)
                  .map((t) => (
                    <tr key={t.id}>
                      <td>{fmtDate(t.posted)}</td>
                      <td>{t.payee || "—"}</td>
                      <td className="text-muted text-sm">
                        {t.description}
                        {t.pending && <span className="badge bg-warning-subtle text-warning-emphasis ms-2">pending</span>}
                      </td>
                      <td className={`text-right ${Number.parseFloat(t.amount) < 0 ? "text-danger" : "text-success"}`}>
                        {fmtMoney(t.amount, account.currency)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Banking({ connections, days, fetched_at }: Props) {
  const [refreshing, setRefreshing] = useState(false);

  function refresh() {
    setRefreshing(true);
    router.reload({ onFinish: () => setRefreshing(false) });
  }

  function changeDays(d: number) {
    router.get("/banking/", { days: d }, { preserveScroll: true });
  }

  const totalAccounts = connections.reduce((sum, c) => sum + c.accounts.length, 0);

  return (
    <div>
      <div className="flex justify-between items-start mb-6 flex-wrap gap-3">
        <div>
          <h1>Banking</h1>
          <p className="text-muted text-sm mb-0">
            Live data from SimpleFIN — fetched {new Date(fetched_at * 1000).toLocaleTimeString()}.
            {totalAccounts > 0 && ` ${totalAccounts} account${totalAccounts === 1 ? "" : "s"} across ${connections.length} connection${connections.length === 1 ? "" : "s"}.`}
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <select
            className="form-select form-select-sm"
            value={days}
            onChange={(e) => changeDays(Number(e.target.value))}
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={60}>Last 60 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <button className="btn btn-primary btn-sm" onClick={refresh} disabled={refreshing}>
            {refreshing ? "Syncing…" : "Sync now"}
          </button>
        </div>
      </div>

      {connections.length === 0 && (
        <div className="card">
          <div className="card-body text-center">
            <p className="mb-3">No SimpleFIN connections yet.</p>
            <a className="btn btn-primary" href="/accounts/settings/">Add a connection</a>
          </div>
        </div>
      )}

      {connections.map((conn) => (
        <div key={conn.id} className="mb-6">
          <h5 className="mb-3">{conn.label}</h5>

          {conn.fetch_error && (
            <div className="alert alert-danger">{conn.fetch_error}</div>
          )}
          {conn.errors.map((e) => (
            <div key={e} className="alert alert-warning py-2">{e}</div>
          ))}

          {conn.accounts.map((acct) => (
            <AccountCard key={acct.id} account={acct} />
          ))}

          {!conn.fetch_error && conn.accounts.length === 0 && (
            <p className="text-muted text-sm">No accounts returned.</p>
          )}
        </div>
      ))}
    </div>
  );
}
