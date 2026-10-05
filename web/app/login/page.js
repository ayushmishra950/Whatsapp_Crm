"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { useAuth, homeFor } from "@/lib/auth";
import { useDocumentTitle } from "@/lib/page-title";
import { Button, Field, Input, PasswordInput } from "@/components/ui";

export default function LoginPage() {
  const { login, session, loading } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  useDocumentTitle("Login · WhatsApp CRM");

  useEffect(() => {
    if (!loading && session) router.replace(homeFor(session.user.role));
  }, [loading, session, router]);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-gradient-to-br from-brand-50 via-white to-slate-100 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-lg shadow-brand-600/20">
            <MessageCircle className="h-6 w-6" />
          </span>
          <h1 className="text-xl font-semibold text-slate-900">WhatsApp CRM</h1>
          <p className="mt-1 text-sm text-slate-500">Sign in to your account</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <Field label="Email">
            <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="Password">
            <PasswordInput autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <Button type="submit" className="w-full justify-center" loading={submitting}>
            Sign in
          </Button>
        </form>
      </div>
    </div>
  );
}
