import { createElement, useState } from "react";
import { router } from "@inertiajs/react";
import AuthLayout from "../layouts/AuthLayout";

interface Props {
  done: boolean;
  errors: Record<string, string>;
}

function getCsrfToken(): string {
  const match = document.cookie.match(/csrftoken=([^;]+)/);
  return match ? match[1] : "";
}

export default function PasswordReset({ done: initialDone, errors: initialErrors }: Props) {
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState(initialErrors);
  const [done, setDone] = useState(initialDone);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErrors({});
    try {
      const body = new URLSearchParams({ email });
      const res = await fetch("/accounts/password/reset/", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-CSRFToken": getCsrfToken(),
          "X-Requested-With": "XMLHttpRequest",
        },
        body: body.toString(),
      });
      if (res.redirected) {
        setDone(true);
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
          <div className="mb-3" style={{ fontSize: "2rem" }}>✉</div>
          <h1 className="h5 fw-semibold mb-2">Check your email</h1>
          <p className="text-muted small mb-4">
            If an account exists for that address, we&apos;ve sent password reset instructions.
          </p>
          <a
            href="/accounts/login/"
            className="btn btn-outline-secondary btn-sm"
            onClick={(e) => { e.preventDefault(); router.visit("/accounts/login/"); }}
          >
            Back to sign in
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="card shadow-sm">
      <div className="card-body p-4">
        <h1 className="h4 mb-1 fw-semibold">Reset password</h1>
        <p className="text-muted small mb-4">Enter your email and we&apos;ll send reset instructions.</p>

        {errors.email && <div className="alert alert-danger py-2 small">{errors.email}</div>}

        <form onSubmit={(e) => void submit(e)}>
          <div className="mb-4">
            <label className="form-label">Email</label>
            <input
              type="email"
              className="form-control"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <button className="btn btn-primary w-100" disabled={loading}>
            {loading ? "Sending…" : "Send reset link"}
          </button>
        </form>

        <div className="text-center mt-3">
          <a
            href="/accounts/login/"
            className="small text-muted"
            onClick={(e) => { e.preventDefault(); router.visit("/accounts/login/"); }}
          >
            Back to sign in
          </a>
        </div>
      </div>
    </div>
  );
}

PasswordReset.layout = (page: React.ReactNode) => createElement(AuthLayout, null, page);
