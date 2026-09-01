import { Router } from "express";
import { authenticate, optionalAuthenticate, requireAdmin, requireCustomer } from "../middleware/auth.js";

import * as auth from "../controllers/auth.js";
import * as services from "../controllers/services.js";
import * as bookings from "../controllers/bookings.js";
import * as receipts from "../controllers/receipts.js";
import * as messages from "../controllers/messages.js";
import * as broadcasts from "../controllers/broadcasts.js";
import * as users from "../controllers/users.js";
import * as payments from "../controllers/payments.js";
import * as promotions from "../controllers/promotions.js";
import * as reconciliation from "../controllers/reconciliation.js";
import * as cashPayments from "../controllers/cashPayments.js";
import * as geocode from "../controllers/geocode.js";

const router = Router();

// ---------- Public ----------
router.get("/health", (req, res) => res.json({ ok: true }));
router.get("/services", optionalAuthenticate, services.listServices);
router.get("/broadcasts/public", broadcasts.listPublicBroadcasts);

// ---------- Auth ----------
router.post("/auth/register", auth.register);
router.post("/auth/login", auth.login);
router.post("/auth/logout", authenticate, auth.logout);
router.get("/auth/me", authenticate, auth.me);
router.post("/auth/heartbeat", authenticate, auth.heartbeat);
router.put("/auth/profile", authenticate, auth.updateProfile);
router.delete("/auth/account", authenticate, auth.deleteAccount);

// ---------- Customer ----------
router.get("/bookings", authenticate, requireCustomer, bookings.listMyBookings);
router.post("/bookings", authenticate, requireCustomer, bookings.createBooking);
router.post("/bookings/:id/checkout", authenticate, requireCustomer, payments.createCheckout);
router.delete("/bookings/:id", authenticate, bookings.deleteBooking);

router.get("/geocode/reverse", authenticate, requireCustomer, geocode.reverseGeocode);

router.get("/receipts", authenticate, requireCustomer, receipts.listMyReceipts);
router.get("/receipts/:id/pdf", authenticate, receipts.downloadReceiptPdf);

router.get("/messages/with/:withId", authenticate, messages.listConversation);
router.post("/messages", authenticate, messages.sendMessage);
router.post("/messages/read/:fromId", authenticate, messages.markRead);

router.get("/broadcasts/mine", authenticate, requireCustomer, broadcasts.listMyBroadcasts);
router.post("/broadcasts/mine/:id/read", authenticate, requireCustomer, broadcasts.markBroadcastRead);

// ---------- Admin ----------
const adminOnly = [authenticate, requireAdmin];

router.get("/admin/users", adminOnly, users.adminListUsers);
router.get("/admin/users/:id", adminOnly, users.adminInspectUser);
router.get("/admin/users/:id/brief", adminOnly, users.adminGetCustomer);
router.get("/admin/contacts", adminOnly, users.adminListContactTargets);
router.get("/admin/stats", adminOnly, users.adminStats);

router.get("/admin/bookings", adminOnly, bookings.adminListBookings);
router.patch("/admin/bookings/:id/status", adminOnly, bookings.adminSetBookingStatus);

router.get("/admin/payments/reconciliation", adminOnly, reconciliation.adminPaymentReconciliation);
router.post("/admin/payments/:bookingId/cash-quote", adminOnly, cashPayments.adminCashQuote);
router.post("/admin/payments/:bookingId/cash-collect", adminOnly, cashPayments.adminCashCollect);
router.post("/admin/payments/:bookingId/cash-refund", adminOnly, cashPayments.adminCashRefund);

router.get("/admin/services", adminOnly, services.adminListServices);
router.post("/admin/services", adminOnly, services.adminCreateService);
router.put("/admin/services/:id", adminOnly, services.adminUpdateService);
router.put("/admin/services/:id/price/global", adminOnly, services.adminSetGlobalPrice);
router.put("/admin/services/:id/price/customer", adminOnly, services.adminSetCustomerPrice);
router.delete("/admin/services/:id/price/customer", adminOnly, services.adminClearCustomerPrice);

router.get("/admin/promotions", adminOnly, promotions.adminListPromotions);
router.post("/admin/promotions", adminOnly, promotions.adminCreatePromotion);
router.patch("/admin/promotions/:id", adminOnly, promotions.adminUpdatePromotion);

router.get("/admin/receipts", adminOnly, receipts.adminListReceipts);
router.post("/admin/receipts", adminOnly, receipts.adminCreateReceipt);
router.get("/admin/receipts/:id/pdf", adminOnly, receipts.downloadReceiptPdf);

router.get("/admin/messages/threads", adminOnly, messages.adminListThreads);
router.get("/admin/messages/with/:withId", adminOnly, messages.listConversation);

router.get("/admin/broadcasts", adminOnly, broadcasts.adminListBroadcasts);
router.post("/admin/broadcasts", adminOnly, broadcasts.adminCreateBroadcast);
router.delete("/admin/broadcasts/:id", adminOnly, broadcasts.adminDeleteBroadcast);

export default router;
