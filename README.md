# Trinitas-Cleaners — Dual-Portal Booking System

A complete web platform for **Trinitas-Cleaners** (Anoka, MN 55303), a local window &
screen cleaning business. Two interconnected but distinct applications share one database:

| App | URL | Audience |
|-----|-----|----------|
| **Customer Portal** (public site + customer dashboard) | `http://localhost:3000` | Everyone + logged-in customers |
| **Admin Portal** (secure) | `http://localhost:3000/admin` | Business owner / staff |

## Tech Stack

- **Frontend:** Next.js 14 (App Router, React 18) — serves both portals
- **Backend:** Express REST API (Node 18+) — `http://localhost:4000`
- **Database:** PostgreSQL in production / **SQLite for zero-setup dev** (Prisma ORM)
- **Auth:** JWT (httpOnly cookie), bcrypt hashing, role-based access control (RBAC)
- **PDF receipts:** `pdfkit` — itemized, downloadable & printable

> Next.js proxies `/api/*` → Express (see `web/next.config.mjs`), so the JWT cookie
> stays same-origin and secure. No CORS headaches in production.

---

## Quick Start

```bash
# 1. Install + migrate + seed (SQLite, zero setup)
cd api && npm install && npm run prisma:setup && cd ..

# 2. Start both servers (two terminals)
cd api && npm run dev          # → http://localhost:4000
cd web && npm run dev          # → http://localhost:3000
```

Seed accounts:

| Role | Email | Password |
|------|-------|----------|
| Admin | `admin@trinitascleaners.com` | `Admin123!` |
| Customer | `customer@example.com` | `Customer123!` |

**Switch to PostgreSQL later:** in `api/prisma/schema.prisma` change `provider = "sqlite"` →
`"postgresql"`, point `DATABASE_URL` at your Postgres DSN in `api/.env`, then
`npm run prisma:setup` again. A `docker-compose.yml` template is provided for local Postgres.

---

## Project Structure

```
trinitas-cleaners/
├── package.json                 # root convenience scripts
├── api/                         # ── Express backend ─────────────────────
│   ├── prisma/
│   │   ├── schema.prisma        # DB schema (SQLite now, Postgres-ready)
│   │   └── seed.js              # admin + customer + services + demo data
│   └── src/
│       ├── index.js             # server bootstrap
│       ├── app.js               # express app (cors, cookies, json, /api router)
│       ├── config.js            # env, constants, role/status whitelists
│       ├── middleware/
│       │   ├── auth.js          # JWT authenticate + requireRole (RBAC) + online heartbeat
│       │   └── error.js
│       ├── utils/
│       │   ├── password.js      # bcrypt hash/verify
│       │   ├── jwt.js           # sign/verify tokens
│       │   ├── validators.js
│       │   ├── prisma.js
│       │   └── pdf.js           # pdfkit itemized receipt builder  ← deliverable
│       ├── controllers/
│       │   ├── auth.js          # register/login/logout/me/profile/delete
│       │   ├── services.js      # catalog + effectivePrice (global vs per-customer)
│       │   ├── bookings.js      # customer book/delete/list + admin accept/decline/worked
│       │   ├── receipts.js      # admin create + list, customer list, PDF download
│       │   ├── messages.js      # customer↔admin thread + admin hub
│       │   ├── broadcasts.js    # notifications/announcements (public/all/specific)
│       │   └── users.js         # admin monitoring + account inspection (impersonation view)
│       └── routes/index.js      # all routes, RBAC applied here
└── web/                         # ── Next.js portals ─────────────────────
    ├── next.config.mjs          # /api → Express rewrite proxy
    ├── components/
    │   ├── Navbar.jsx           # adaptive nav (public / customer / admin)
    │   ├── Footer.jsx
    │   └── Shell.jsx            # sidebar shell for both dashboards
    ├── lib/
    │   ├── api.js               # fetch wrapper + money/date formatters
    │   └── auth.jsx             # AuthProvider, RequireCustomer/RequireAdmin, heartbeat
    └── app/
        ├── layout.js, globals.css
        ├── page.jsx             # landing page (CTAs, services, announcements)
        ├── services/ · announcements/ · contact/ · login/ · signup/
        ├── dashboard/           # customer portal (protected)
        │   ├── page.jsx         #   overview + broadcasts
        │   ├── bookings/        #   history, delete, status filters
        │   ├── services/        #   service selection + booking form
        │   ├── receipts/        #   list + [id] itemized receipt w/ Print & Download PDF
        │   ├── messages/        #   contact-the-admin chat
        │   └── settings/        #   profile, logout, delete account
        └── admin/               # admin portal (protected, RBAC)
            ├── page.jsx         #   live stats + who's online
            ├── users/           #   monitoring + [id] account inspection
            ├── bookings/        #   accept/decline, Accepted&Worked / Declined sessions
            ├── pricing/         #   global vs per-customer price control
            ├── receipts/        #   generate + send + PDF
            ├── messages/        #   communication hub (threads)
            └── broadcasts/      #   notifications & announcements publishing
```

---

## Database Schema (Prisma)

`api/prisma/schema.prisma` — all fields from your spec. `role`, `status`, and
broadcast/booking `type` fields are Strings (SQLite has no enums); they are
whitelisted in `api/src/config.js` and validated in controllers. On PostgreSQL you
can switch them to native enums.

```prisma
model User            { id email passwordHash name phone address role status lastActiveAt … }
model Service         { id name description basePrice isActive … }
model CustomPrice     { id serviceId customerId price }          // per-customer override
model Booking         { id customerId serviceId date note status price … }
model Receipt         { id customerId bookingId? subtotal taxRate tax discount total note pdfUrl? … }
model Message         { id senderId receiverId content readAt createdAt … }
model Broadcast       { id type target title content userId? createdAt … }
model UserBroadcastRead { userId broadcastId readAt }
```

Price resolution logic (`api/src/controllers/services.js#effectivePrice`):
a `CustomPrice` row for the customer overrides `Service.basePrice` (global); otherwise
the global price applies. Bookings snapshot the price at booking time.

---

## Core Flows (boilerplate highlights)

### 1. Authentication + RBAC

- `api/src/utils/jwt.js` + `password.js` — sign/verify JWT, bcrypt.
- `api/src/middleware/auth.js` — reads httpOnly cookie/header, attaches `req.user`,
  refreshes `lastActiveAt` (drives online/offline), and `requireRole("admin")` /
  `requireRole("customer")` strictly gate every route in `routes/index.js`.
- Customer ↔ admin separation is enforced server-side: customers cannot hit `/admin/*`
  and admins cannot use customer booking endpoints (verified 403 both ways).

### 2. Booking system

- Customer: `POST /api/bookings` (price quoted via `effectivePrice`), `DELETE`, list.
- Admin: `PATCH /api/admin/bookings/:id/status` toggles `pending → accepted |
  declined | worked`. Accepted/worked land in the **Accepted & Worked** tab, declined
  in the **Declined** tab (see `web/app/admin/bookings`).
- Both parties get a Broadcast notification on creation/decision.

### 3. Admin receipt PDF generation

- `api/src/utils/pdf.js#buildReceiptPdf` — `pdfkit` letter-size receipt: business
  block, billed-to block, itemized line (subtotal, tax%, discount), bold TOTAL,
  footer. Same generator serves customers (`/api/receipts/:id/pdf`) and admins
  (`/api/admin/receipts/:id/pdf`).
- In-app receipt: `web/app/dashboard/receipts/[id]` renders an itemized receipt with
  **Print** (print CSS isolates the sheet) and **Download PDF** buttons.

### 4. Monitoring & impersonation

- `api/src/controllers/users.js#adminInspectUser` returns a customer's full dashboard
  data (bookings, service catalog with personalized prices, receipts, messages) so the
  admin can see exactly what the customer sees — no password required.

---

## Step-by-Step Implementation Plan

**Phase 1 — Foundation (days 1–2)**
1. Scaffold monorepo (`api/`, `web/`), `npm install`, `.env` files.
2. Define Prisma schema; `prisma migrate dev --name init`; write seed script.
3. Express bootstrap: CORS, cookie-parser, JSON, error middleware, `/api/health`.

**Phase 2 — Auth & RBAC (days 2–3)**
4. bcrypt + JWT utils; register/login/logout/me endpoints with httpOnly cookie.
5. `authenticate` + `requireRole` middleware; wire every route.
6. Next.js proxy rewrite, `AuthProvider`, `RequireCustomer`/`RequireAdmin`, navbar.

**Phase 3 — Customer Portal (days 4–6)**
7. Public pages: landing, services, announcements (from broadcasts), contact.
8. Service catalog endpoint + `effectivePrice`; customer booking create/list/delete.
9. Customer dashboard: overview, bookings, services/booking form, settings (profile,
   logout, delete account), messages chat.

**Phase 4 — Admin Portal (days 6–8)**
10. Admin dashboard + live user monitoring (status via heartbeat, 15s poll).
11. Booking management with Accept/Decline/Worked + session tabs.
12. Pricing control: global base price + per-customer `CustomPrice` overrides.
13. Receipt generation (pdfkit), issue/send, customer notification.
14. Communication hub (threads + reply), notifications & announcements publishing
    (type + target selectable).

**Phase 5 — Hardening & Production (days 9–12)**
15. Switch to PostgreSQL, run migrations, update `DATABASE_URL`.
16. Rate-limit auth endpoints, stricter input validation, helmet, CORS to production domain.
17. CI: `npm run build` both apps; smoke tests on the API (register → book → accept → receipt).
18. Deploy API + web (Vercel for Next, Render/Fly/Railway for API), point rewrite to
    the deployed API, rotate `JWT_SECRET`.

---

## API Reference (summary)

| Method | Route | Access |
|--------|-------|--------|
| POST | `/api/auth/register`, `/login`, `/logout` | public / public / auth |
| GET | `/api/auth/me` · POST `/api/auth/heartbeat` | auth |
| PUT | `/api/auth/profile` · DELETE `/api/auth/account` | customer |
| GET | `/api/services` | public (prices personalized when authed) |
| GET/POST | `/api/bookings` · DELETE `/api/bookings/:id` | customer |
| GET | `/api/receipts` · GET `/api/receipts/:id/pdf` | customer |
| GET/POST | `/api/messages/with/:id` · `/api/messages` · `/api/messages/read/:fromId` | auth |
| GET | `/api/broadcasts/public` | public |
| GET/POST | `/api/broadcasts/mine` (+ `/:id/read`) | customer |
| GET | `/api/admin/stats` · `/api/admin/users` | admin |
| GET | `/api/admin/users/:id` (inspect) | admin |
| GET/PATCH | `/api/admin/bookings` · `/api/admin/bookings/:id/status` | admin |
| PUT | `/api/admin/services/:id/price/global` · `.../price/customer` | admin |
| GET/POST | `/api/admin/receipts` · GET `/api/admin/receipts/:id/pdf` | admin |
| GET | `/api/admin/messages/threads` · `/api/admin/messages/with/:id` | admin |
| GET/POST/DELETE | `/api/admin/broadcasts` | admin |