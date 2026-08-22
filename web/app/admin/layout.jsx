"use client";

import { RequireAdmin } from "@/lib/auth";

export default function AdminLayout({ children }) {
  return <RequireAdmin>{children}</RequireAdmin>;
}