import { router } from "@inertiajs/react";
import { createElement, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getCsrfToken } from "@/lib/api";
import AuthLayout from "../layouts/AuthLayout";

interface Props {
  email: string;
  invalid: boolean;
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
      <Card>
        <CardContent className="text-center">
          <h1 className="text-xl font-semibold mb-2">Invalid confirmation link</h1>
          <p className="text-muted-foreground text-sm mb-6">This link is invalid or has already been used.</p>
          <Button asChild variant="outline" size="sm">
            <a
              href="/accounts/login/"
              onClick={(e) => {
                e.preventDefault();
                router.visit("/accounts/login/");
              }}
            >
              Back to sign in
            </a>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (done) {
    return (
      <Card>
        <CardContent className="text-center">
          <div className="mb-4 text-3xl text-primary">✓</div>
          <h1 className="text-xl font-semibold mb-2">Email confirmed</h1>
          <p className="text-muted-foreground text-sm mb-6">{email} has been verified.</p>
          <Button asChild size="sm">
            <a
              href="/"
              onClick={(e) => {
                e.preventDefault();
                router.visit("/");
              }}
            >
              Continue
            </a>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="text-center">
        <h1 className="text-xl font-semibold mb-2">Confirm your email</h1>
        <p className="text-muted-foreground text-sm mb-6">
          Click below to verify <strong className="text-foreground">{email}</strong>.
        </p>
        <Button disabled={loading} onClick={() => void confirm()}>
          {loading ? "Confirming…" : "Confirm email address"}
        </Button>
      </CardContent>
    </Card>
  );
}

EmailConfirm.layout = (page: React.ReactNode) => createElement(AuthLayout, null, page);
