import { createElement, useState } from "react";
import { router } from "@inertiajs/react";
import AuthLayout from "../layouts/AuthLayout";

interface Props {
  done: boolean;
  token_fail: boolean;
  errors: Record<string, string>;
}

function getCsrfToken(): string {
  const match = document.cookie.match(/csrftoken=([^;]+)/);
  return match ? match[1] : "";
}

export default function PasswordResetConfirm({ done, token_fail, errors: initialErrors }: Props) {
  const [password1, setPassword1] = useState("");
  const [password2, setPassword2] = useState("");
  const [errors, setErrors] = useState(initialErrors);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErrors({});
    try {
      const body = new URLSearchParams({ password1, password2 });
      const res = await fetch(window.location.pathname, {
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
        setErrors(data.errors ?? {});
      }
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="card shadow-sm">
        <div className="card-body p-4 text-center">
          <div className="mb-3" style={{ fontSize: "2rem" }}>✓</div>
          <h1 className="h5 fw-semibold mb-2">Password changed</h1>
          <p className="text-muted small mb-4">Your password has been updated. You can now sign in.</p>
          <a
            href="/accounts/login/"
            className="btn btn-primary"
            onClick={(e) => { e.preventDefault(); router.visit("/accounts/login/"); }}
          >
            Sign in
          </a>
        </div>
      </div>
    );
  }

  if (token_fail) {
    return (
      <div className="card shadow-sm">
        <div className="card-body p-4 text-center">
          <h1 className="h5 fw-semibold mb-2">Link expired</h1>
          <p className="text-muted small mb-4">
            This password reset link is invalid or has already been used.
          </p>
          <a
            href="/accounts/password/reset/"
            className="btn btn-primary"
            onClick={(e) => { e.preventDefault(); router.visit("/accounts/password/reset/"); }}
          >
            Request a new link
          </a>
        </div>
      </div>
    );
  }

  const error = errors.password1 ?? errors.password2 ?? errors.__all__ ?? null;

  return (
    <div className="card shadow-sm">
      <div className="card-body p-4">
        <h1 className="h4 mb-1 fw-semibold">New password</h1>
        <p className="text-muted small mb-4">Choose a new password for your account.</p>

        {error && <div className="alert alert-danger py-2 small">{error}</div>}

        <form onSubmit={(e) => void submit(e)}>
          <div className="mb-3">
            <label className="form-label">New password</label>
            <input
              type="password"
              className="form-control"
              autoFocus
              autoComplete="new-password"
              value={password1}
              onChange={(e) => setPassword1(e.target.value)}
            />
          </div>
          <div className="mb-4">
            <label className="form-label">Confirm new password</label>
            <input
              type="password"
              className="form-control"
              autoComplete="new-password"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
            />
          </div>
          <button className="btn btn-primary w-100" disabled={loading}>
            {loading ? "Saving…" : "Set new password"}
          </button>
        </form>
      </div>
    </div>
  );
}

PasswordResetConfirm.layout = (page: React.ReactNode) => createElement(AuthLayout, null, page);
