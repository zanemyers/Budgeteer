import { router } from "@inertiajs/react";
import { createElement, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage, getCsrfToken } from "@/lib/api";
import { PasswordInput } from "../components/PasswordInput";
import AuthLayout from "../layouts/AuthLayout";

interface Props {
  errors: Record<string, string>;
  next: string;
}

export default function Signup({ errors: initialErrors, next }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState(initialErrors);
  const [loading, setLoading] = useState(false);

  const error = errors.__all__ ?? errors.email ?? errors.password1 ?? null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErrors({});
    try {
      const body = new URLSearchParams({ email, password1: password, next });
      const res = await fetch("/accounts/signup/", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-CSRFToken": getCsrfToken(),
          "X-Requested-With": "XMLHttpRequest",
        },
        body: body.toString(),
      });
      // Non-AJAX path: fetch followed an HTTP redirect.
      if (res.redirected) {
        router.visit(res.url);
        return;
      }
      // allauth AJAX shape: success is {location}. On failure, per-field messages live under
      // form.fields.<name>.errors, and non-field ones under form.errors.
      const data = (await res.json().catch(() => null)) as {
        location?: string;
        form?: { errors?: string[]; fields?: Record<string, { errors?: string[] }> };
        errors?: Record<string, string>;
      } | null;
      if (res.ok && data?.location) {
        // Full navigation so the new session cookie initializes auth state cleanly.
        window.location.assign(data.location);
        return;
      }
      const collected: Record<string, string> = { ...(data?.errors ?? {}) };
      for (const [field, info] of Object.entries(data?.form?.fields ?? {})) {
        const msg = info?.errors?.[0];
        if (msg) collected[field] = msg;
      }
      if (data?.form?.errors?.length) collected.__all__ = data.form.errors[0];
      setErrors(
        Object.keys(collected).length ? collected : { __all__: "Could not create your account. Please try again." },
      );
    } catch (err) {
      setErrors({ __all__: errorMessage(err, "Could not create your account. Please try again.") });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardContent>
        <h1 className="mb-6 text-2xl font-semibold">Create account</h1>

        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Password</Label>
            <PasswordInput
              id="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              At least 8 characters. Not a common or all-numeric password.
            </p>
          </div>
          <Button className="w-full mt-2" disabled={loading}>
            {loading ? "Creating account…" : "Create account"}
          </Button>
        </form>

        <p className="mt-6 text-sm text-muted-foreground text-center">
          Already have an account?{" "}
          <a href="/accounts/login/" className="text-moss hover:underline">
            Sign in
          </a>
        </p>
      </CardContent>
    </Card>
  );
}

Signup.layout = (page: React.ReactNode) => createElement(AuthLayout, null, page);
