import { createElement, useState } from "react";
import { router } from "@inertiajs/react";
import AuthLayout from "../layouts/AuthLayout";

interface Props {
  email: string;
  invalid: boolean;
}

function getCsrfToken(): string {
  const match = document.cookie.match(/csrftoken=([^;]+)/);
  return match ? match[1] : "";
}

export default function EmailConfirm({ email, invalid }: Props) {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function confirm() {
    setLoading(true);
    try {
      const res = await fetch(window.location.pathname, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-CSRFToken": getCsrfToken(),
          "X-Requested-With": "XMLHttpRequest",
        },
        body: "",
      });
      if (res.redirected) {
        router.visit(res.url);
      } else {
        setDone(true);
      }
    } finally {
      setLoading(false);
    }
  }

  if (invalid) {
    return (
      <div className="card shadow-sm">
        <div className="card-body p-6 text-center">
          <h1 className="font-semibold mb-2">Invalid confirmation link</h1>
          <p className="text-muted text-sm mb-6">This link is invalid or has already been used.</p>
          <a href="/accounts/login/" className="btn btn-outline-secondary btn-sm"
            onClick={(e) => { e.preventDefault(); router.visit("/accounts/login/"); }}>
            Back to sign in
          </a>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="card shadow-sm">
        <div className="card-body p-6 text-center">
          <div className="mb-4" style={{ fontSize: "2rem" }}>✓</div>
          <h1 className="font-semibold mb-2">Email confirmed</h1>
          <p className="text-muted text-sm mb-6">{email} has been verified.</p>
          <a href="/" className="btn btn-primary btn-sm"
            onClick={(e) => { e.preventDefault(); router.visit("/"); }}>
            Continue
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="card shadow-sm">
      <div className="card-body p-6 text-center">
        <h1 className="font-semibold mb-2">Confirm your email</h1>
        <p className="text-muted text-sm mb-6">
          Click below to verify <strong>{email}</strong>.
        </p>
        <button className="btn btn-primary" disabled={loading} onClick={() => void confirm()}>
          {loading ? "Confirming…" : "Confirm email address"}
        </button>
      </div>
    </div>
  );
}

EmailConfirm.layout = (page: React.ReactNode) => createElement(AuthLayout, null, page);
