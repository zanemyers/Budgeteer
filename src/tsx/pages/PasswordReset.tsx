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
  errors: Record<string, string>;
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
        const data = (await res.json().catch(() => ({}))) as { errors?: Record<string, string> };
        setErrors(data.errors ?? {});
      }
    } catch (err) {
      setErrors({ __all__: errorMessage(err, "Could not send the reset email. Please try again.") });
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <Card>
        <CardContent className="text-center">
          <div className="mb-4 text-3xl text-primary">✉</div>
          <h1 className="text-xl font-semibold mb-2">Check your email</h1>
          <p className="text-muted-foreground text-sm mb-6">
            If an account exists for that address, we&apos;ve sent password reset instructions.
          </p>
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

  return (
    <Card>
      <CardContent>
        <h1 className="text-2xl font-semibold mb-1">Reset password</h1>
        <p className="text-muted-foreground text-sm mb-6">Enter your email and we&apos;ll send reset instructions.</p>

        {errors.email && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{errors.email}</AlertDescription>
          </Alert>
        )}

        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <Button className="w-full mt-2" disabled={loading}>
            {loading ? "Sending…" : "Send reset link"}
          </Button>
        </form>

        <div className="text-center mt-4">
          <a
            href="/accounts/login/"
            className="touch-target text-sm text-muted-foreground hover:underline"
            onClick={(e) => {
              e.preventDefault();
              router.visit("/accounts/login/");
            }}
          >
            Back to sign in
          </a>
        </div>
      </CardContent>
    </Card>
  );
}

PasswordReset.layout = (page: React.ReactNode) => createElement(AuthLayout, null, page);
