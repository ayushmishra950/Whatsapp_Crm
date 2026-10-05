"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth, homeFor } from "@/lib/auth";
import { PageLoader } from "@/components/ui";
import { useDocumentTitle } from "@/lib/page-title";

export default function Home() {
  const { session, loading } = useAuth();
  const router = useRouter();
  useDocumentTitle("WhatsApp CRM");
  useEffect(() => {
    if (!loading) router.replace(session ? homeFor(session.user.role) : "/login");
  }, [loading, session, router]);
  return <PageLoader />;
}
