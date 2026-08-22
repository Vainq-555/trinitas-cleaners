"use client";

import { RequireCustomer } from "@/lib/auth";

export default function CustomerLayout({ children }) {
  return <RequireCustomer>{children}</RequireCustomer>;
}