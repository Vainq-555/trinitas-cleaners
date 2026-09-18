import { Router } from "express";
import { authenticate, optionalAuthenticate, requireAdmin, requireCustomer } from "../middleware/auth.js";

import * as auth from "../controllers/auth.js";
import * as services from "../controllers/services.js";
import * as bookings from "../controllers/bookings.js";
import * as receipts from "../controllers/receipts.js";
import * as messages from "../controllers/messages.js";
import * as broadcasts from "../controllers/broadcasts.js";
import * as content from "../controllers/content.js";
import * as community from "../controllers/community.js";
import * as profiles from "../controllers/profiles.js";
import * as groups from "../controllers/groups.js";
import * as reviews from "../controllers/reviews.js";
import * as users from "../controllers/users.js";
import * as businessInfo from "../controllers/businessInfo.js";
import * as serviceAreas from "../controllers/serviceAreas.js";
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
router.get("/content/:page", content.listPublicContent);
router.get("/reviews", reviews.listPublicReviews);
router.get("/business-information", businessInfo.getBusinessInfo);
router.get("/service-areas", serviceAreas.listPublicServiceAreas);

// ---------- Auth ----------
router.post("/auth/register", auth.register);
router.post("/auth/login", auth.login);
router.post("/auth/forgot-password", auth.forgotPassword);
router.post("/auth/reset-password", auth.resetPassword);
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
router.get("/receipts/:id", authenticate, receipts.receiptDetail);
router.get("/receipts/:id/pdf", authenticate, receipts.downloadReceiptPdf);

router.get("/messages/with/:withId", authenticate, messages.listConversation);
router.post("/messages", authenticate, messages.sendMessage);
router.post("/messages/read/:fromId", authenticate, messages.markRead);

router.get("/broadcasts/mine", authenticate, requireCustomer, broadcasts.listMyBroadcasts);
router.post("/broadcasts/mine/:id/read", authenticate, requireCustomer, broadcasts.markBroadcastRead);

router.get("/reviews/mine", authenticate, requireCustomer, reviews.listMyReviews);
router.post("/reviews", authenticate, requireCustomer, reviews.createReview);

router.get("/community/messages", authenticate, requireCustomer, community.listCommunityMessages);
router.post("/community/messages", authenticate, requireCustomer, community.createCommunityMessage);

router.get("/community/groups", authenticate, requireCustomer, groups.listGroups);
router.post("/community/groups", authenticate, requireCustomer, groups.createGroup);
router.get("/community/groups/:groupId", authenticate, requireCustomer, groups.getGroup);
router.post("/community/groups/:groupId/join", authenticate, requireCustomer, groups.joinGroup);
router.post("/community/groups/:groupId/leave", authenticate, requireCustomer, groups.leaveGroup);

router.get("/community/groups/:groupId/members", authenticate, requireCustomer, groups.listGroupMembers);
router.get("/community/groups/:groupId/messages", authenticate, requireCustomer, groups.listGroupMessages);
router.post("/community/groups/:groupId/messages", authenticate, requireCustomer, groups.sendGroupMessage);
router.delete("/community/groups/:groupId/messages/:messageId", authenticate, requireCustomer, groups.deleteGroupMessage);
router.patch("/community/groups/:groupId", authenticate, requireCustomer, groups.updateGroup);
router.delete("/community/groups/:groupId/members/:userId", authenticate, requireCustomer, groups.removeGroupMember);
router.post("/community/groups/:groupId/transfer", authenticate, requireCustomer, groups.transferGroupOwner);
router.post("/community/groups/:groupId/dissolve", authenticate, requireCustomer, groups.dissolveGroup);

router.get("/profile", authenticate, requireCustomer, profiles.getOwnProfile);
router.put("/profile", authenticate, requireCustomer, profiles.updateOwnProfile);
router.get("/profile/:userId", authenticate, requireCustomer, profiles.getPublicProfile);

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

router.get("/admin/content/:page", adminOnly, content.adminListContent);
router.post("/admin/content/:page", adminOnly, content.adminCreateContent);
router.put("/admin/content/:page/:id", adminOnly, content.adminUpdateContent);
router.delete("/admin/content/:page/:id", adminOnly, content.adminDeleteContent);

router.get("/admin/reviews", adminOnly, reviews.adminListReviews);
router.patch("/admin/reviews/:id/status", adminOnly, reviews.adminSetReviewStatus);

router.get("/admin/community/messages", adminOnly, community.adminListCommunityMessages);
router.get("/admin/community/users", adminOnly, community.adminListCommunityUsers);
router.post("/admin/community/users/:id/block", adminOnly, community.adminBlockUser);
router.post("/admin/community/users/:id/unblock", adminOnly, community.adminUnblockUser);

router.get("/admin/community/profiles", adminOnly, profiles.adminListProfiles);
router.get("/admin/community/profiles/:userId", adminOnly, profiles.adminGetProfile);
router.post("/admin/community/profiles/:userId/hide", adminOnly, profiles.adminHideProfile);
router.post("/admin/community/profiles/:userId/unhide", adminOnly, profiles.adminUnhideProfile);

router.get("/admin/community/groups", adminOnly, groups.adminListGroups);
router.get("/admin/community/groups/:groupId", adminOnly, groups.adminGetGroup);
router.get("/admin/community/groups/:groupId/members", adminOnly, groups.adminListGroupMembers);
router.get("/admin/community/groups/:groupId/messages", adminOnly, groups.adminListGroupMessages);
router.delete("/admin/community/groups/:groupId/members/:userId", adminOnly, groups.adminRemoveGroupMember);
router.delete("/admin/community/groups/:groupId/messages/:messageId", adminOnly, groups.adminDeleteGroupMessage);
router.post("/admin/community/groups/:groupId/dissolve", adminOnly, groups.adminDissolveGroup);

router.get("/admin/business-information", adminOnly, businessInfo.adminGetBusinessInfo);
router.put("/admin/business-information", adminOnly, businessInfo.adminPutBusinessInfo);

router.get("/admin/service-areas", adminOnly, serviceAreas.adminListServiceAreas);
router.post("/admin/service-areas", adminOnly, serviceAreas.adminCreateServiceArea);
router.put("/admin/service-areas/:id", adminOnly, serviceAreas.adminUpdateServiceArea);
router.delete("/admin/service-areas/:id", adminOnly, serviceAreas.adminDeleteServiceArea);

export default router;
