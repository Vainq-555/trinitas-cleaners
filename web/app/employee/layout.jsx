"use client";

import { RequireEmployee } from "@/lib/auth";

export default function EmployeeLayout({ children }) {
  return <RequireEmployee>{children}</RequireEmployee>;
}
