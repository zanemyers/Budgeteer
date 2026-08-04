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
      // Older allauth / non-AJAX path: fetch followed an HTTP redirect.
      if (res.redirected) {
        router.visit(res.url);
        return;
      }
      // Modern allauth returns its AJAX shape: 200 with {location, form: {errors}, html}
      // on both success AND enumeration-protected failure. Success sets a sessionid cookie
      // that we can't read (HttpOnly), so trust `location` and let the server bounce us
      // back to login if auth didn't actually take.
      const data = (await res.json().catch(() => null)) as {
        location?: string;
        form?: { errors?: unknown[] };
        errors?: Record<string, string>;
      } | null;
      if (res.ok && data?.location) {
        // Full navigation so the session cookie initializes auth state cleanly.
        window.location.assign(data.location);
        return;
      }
      const formErrors =
        Array.isArray(data?.form?.errors) && data.form.errors.length > 0
          ? { __all__: String(data.form.errors[0]) }
          : null;
      setErrors(data?.errors ?? formErrors ?? { __all__: "Invalid email or password." });
    } catch (err) {
      setErrors({ __all__: errorMessage(err, "Could not sign in. Please try again.") });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardContent>
        <h1 className="mb-6 text-2xl font-semibold">Sign in</h1>

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
            <div className="flex justify-between items-center">
              <Label htmlFor="password">Password</Label>
              <a href="/accounts/password/reset/" className="text-sm text-muted-foreground hover:underline">
                Forgot password?
              </a>
            </div>
            <PasswordInput
              id="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <Button className="w-full mt-2" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </Button>
        </form>

        <p className="mt-6 text-sm text-muted-foreground text-center">
          New to Budgeteer?{" "}
          <a href="/accounts/signup/" className="text-moss hover:underline">
            Create an account
          </a>
        </p>
      </CardContent>
    </Card>
  );
}

Login.layout = (page: React.ReactNode) => createElement(AuthLayout, null, page);
