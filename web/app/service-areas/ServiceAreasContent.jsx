"use client";

import { Phone, Mail, CalendarDays, MapPin, CheckCircle2 } from "lucide-react";
import { useBusinessInfo } from "@/lib/businessInfo";
import {
  telHref,
  splitHoursRow,
  formatAddress,
  formatAddressLong,
} from "@/lib/businessInfoData";

// Intro tagline ("Proudly serving Anoka, MN 55303 and surrounding communities.")
export function ServiceAreasTeaser() {
  const { business } = useBusinessInfo();
  return (
    <p className="mt-3 text-muted">
      Proudly serving {formatAddress(business)} and surrounding communities.
    </p>
  );
}

// Primary coverage cards — one per active area, ordered by the admin.
export function ServiceAreaCards() {
  const { areas, business } = useBusinessInfo();
  const heading = formatAddressLong(business);
  return (
    <section className="mt-12 max-w-3xl space-y-10">
      {areas.map((area) => {
        const areaHeading = formatAddressLong(area) || heading;
        return (
          <div key={area.id ?? `${area.name}-${area.city}`}>
            <h2 className="text-2xl font-extrabold tracking-tight text-ink">{areaHeading}</h2>
            <div className="mt-4 card p-6">
              <div className="flex items-start gap-4">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-brand-light text-brand">
                  <MapPin size={22} />
                </span>
                <div>
                  <h3 className="font-bold text-ink">Locally owned &amp; operated</h3>
                  <p className="mt-2 text-sm text-muted leading-relaxed">
                    Serving homes and businesses across {areaHeading}, we keep pricing
                    transparent and back every job with a streak-free guarantee we stand behind.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
                    {["Locally owned & operated", "Streak-free guarantee", "Free estimates"].map((t) => (
                      <span key={t} className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600">
                        <CheckCircle2 size={15} className="text-clean" /> {t}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </section>
  );
}

// Phone / email / hours cards driven entirely by admin-controlled business info.
export function BusinessInfoCards() {
  const { business } = useBusinessInfo();
  const week = splitHoursRow(business.hoursWeek);
  const weekend = splitHoursRow(business.hoursWeekend);
  return (
    <div className="mt-4 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      <div className="card p-6 transition-all duration-200 hover:-translate-y-1 hover:shadow-lift">
        <span className="grid h-12 w-12 place-items-center rounded-xl bg-brand-light text-brand">
          <Phone size={22} />
        </span>
        <h3 className="mt-4 font-bold text-ink">Call us</h3>
        <p className="mt-1 font-semibold text-brand">{business.phone}</p>
        <p className="text-sm text-muted">Tap to call — we answer fast</p>
        <a href={telHref(business.phone)} className="btn btn-outline btn-sm mt-4">Get in touch</a>
      </div>

      <div className="card p-6 transition-all duration-200 hover:-translate-y-1 hover:shadow-lift">
        <span className="grid h-12 w-12 place-items-center rounded-xl bg-clean-light text-clean">
          <Mail size={22} />
        </span>
        <h3 className="mt-4 font-bold text-ink">Email us</h3>
        <p className="mt-1 font-semibold text-brand">{business.email}</p>
        <p className="text-sm text-muted">{business.responseTime}</p>
        <a href={`mailto:${business.email}`} className="btn btn-outline btn-sm mt-4">Get in touch</a>
      </div>

      <div className="card p-6 transition-all duration-200 hover:-translate-y-1 hover:shadow-lift">
        <span className="grid h-12 w-12 place-items-center rounded-xl bg-warnbg text-amber-600">
          <CalendarDays size={22} />
        </span>
        <h3 className="mt-4 font-bold text-ink">Business hours</h3>
        <div className="mt-2 space-y-2 text-sm text-slate-700">
          <p className="flex items-center justify-between border-b border-line pb-2">
            <span>{week ? week.days : business.hoursWeek}</span>
            {week != null && <span className="font-semibold">{week.time}</span>}
          </p>
          <p className="flex items-center justify-between">
            <span>{weekend ? weekend.days : business.hoursWeekend}</span>
            {weekend != null && <span className="font-semibold text-muted">{weekend.time}</span>}
          </p>
        </div>
      </div>
    </div>
  );
}