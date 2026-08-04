import { router } from "@inertiajs/react";
import { createElement, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage, getCsrfToken } from "@/lib/api";
import AuthLayout from "../layouts/AuthLayout";

interface Props {
  done: boolean;
  token_fail: boolean;
  errors: Record<string, string>;
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
        const data = (await res.json().catch(() => ({}))) as { errors?: Record<string, string> };
        setErrors(data.errors ?? {});
      }
    } catch (err) {
      setErrors({ __all__: errorMessage(err, "Could not reset your password. Please try again.") });
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <Card>
        <CardContent className="text-center">
          <div className="mb-4 text-3xl text-primary">✓</div>
          <h1 className="text-xl font-semibold mb-2">Password changed</h1>
          <p className="text-muted-foreground text-sm mb-6">Your password has been updated. You can now sign in.</p>
          <Button asChild>
            <a
              href="/accounts/login/"
              onClick={(e) => {
                e.preventDefault();
                router.visit("/accounts/login/");
              }}
            >
              Sign in
            </a>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (token_fail) {
    return (
      <Card>
        <CardContent className="text-center">
          <h1 className="text-xl font-semibold mb-2">Link expired</h1>
          <p className="text-muted-foreground text-sm mb-6">
            This password reset link is invalid or has already been used.
          </p>
          <Button asChild>
            <a
              href="/accounts/password/reset/"
              onClick={(e) => {
                e.preventDefault();
                router.visit("/accounts/password/reset/");
              }}
            >
              Request a new link
            </a>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const error = errors.password1 ?? errors.password2 ?? errors.__all__ ?? null;

  return (
    <Card>
      <CardContent>
        <h1 className="text-2xl font-semibold mb-1">New password</h1>
        <p className="text-muted-foreground text-sm mb-6">Choose a new password for your account.</p>

        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="pw1">New password</Label>
            <Input
              id="pw1"
              type="password"
              autoFocus
              autoComplete="new-password"
              value={password1}
              onChange={(e) => setPassword1(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="pw2">Confirm new password</Label>
            <Input
              id="pw2"
              type="password"
              autoComplete="new-password"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
            />
          </div>
          <Button className="w-full mt-2" disabled={loading}>
            {loading ? "Saving…" : "Set new password"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

PasswordResetConfirm.layout = (page: React.ReactNode) => createElement(AuthLayout, null, page);
