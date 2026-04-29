import { createElement, useState } from "react";
import { router } from "@inertiajs/react";
import AuthLayout from "../layouts/AuthLayout";

interface Props {
  errors: Record<string, string>;
  next: string;
}

function getCsrfToken(): string {
  const match = document.cookie.match(/csrftoken=([^;]+)/);
  return match ? match[1] : "";
}

export default function Login({ errors: initialErrors, next }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState(initialErrors);
  const [loading, setLoading] = useState(false);

  const error = errors.__all__ ?? errors.login ?? errors.password ?? null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErrors({});
    try {
      const body = new URLSearchParams({ login: email, password, next });
      const res = await fetch("/accounts/login/", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-CSRFToken": getCsrfToken(),
          "X-Requested-With": "XMLHttpRequest",
        },
        body: body.toString(),
      });
      if (res.redirected) {
        router.visit(res.url);
      } else {
        const data = await res.json() as { errors: Record<string, string> };
        setErrors(data.errors ?? { __all__: "Invalid email or password." });
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card shadow-sm">
      <div className="card-body p-4">
        <h1 className="h4 mb-4 fw-semibold">Sign in</h1>

        {error && <div className="alert alert-danger py-2 small">{error}</div>}

        <form onSubmit={(e) => void submit(e)}>
          <div className="mb-3">
            <label className="form-label">Email</label>
            <input
              type="email"
              className="form-control"
              autoComplete="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="mb-4">
            <div className="d-flex justify-content-between align-items-center mb-1">
              <label className="form-label mb-0">Password</label>
              <a href="/accounts/password/reset/" className="small text-muted">
                Forgot password?
              </a>
            </div>
            <input
              type="password"
              className="form-control"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button className="btn btn-primary w-100" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}

Login.layout = (page: React.ReactNode) => createElement(AuthLayout, null, page);
