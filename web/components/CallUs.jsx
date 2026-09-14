"use client";

import { Phone } from "lucide-react";
import { useBusinessInfo } from "@/lib/businessInfo";
import { telHref } from "@/lib/businessInfoData";

// Client island for tel links inside Server Components. Derives the href from
// the admin-controlled business phone; hidden if no phone is available.
export default function CallUs({ className = "", iconSize = 16, label }) {
  const { business } = useBusinessInfo();
  const href = telHref(business.phone);
  if (!href) return null;
  return (
    <a href={href} className={className}>
      <Phone size={iconSize} /> {label ?? business.phone}
    </a>
  );
}