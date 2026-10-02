import { Router } from "express";
import { authenticate, optionalAuthenticate, requireAdmin, requireCustomer, requireEmployee } from "../middleware/auth.js";

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
import * as subscriptions from "../controllers/subscriptions.js";
import * as geocode from "../controllers/geocode.js";
import * as employees from "../controllers/employees.js";
import * as assignments from "../controllers/assignments.js";
import * as availability from "../controllers/availability.js";
import * as shifts from "../controllers/shifts.js";
import * as employeeLeave from "../controllers/employeeLeave.js";
import * as employeeCommunity from "../controllers/employeeCommunity.js";

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
// Employee self-activation: public + rate-limited, because the invitee has no
// password yet. Redeems a single-use invitation token and sets their first
// password. Nothing here can target another account (see the handler).
router.post("/auth/employee-activation", auth.activateEmployeeAccount);
router.post("/auth/logout", authenticate, auth.logout);
router.get("/auth/me", authenticate, auth.me);
router.post("/auth/heartbeat", authenticate, auth.heartbeat);
router.put("/auth/profile", authenticate, auth.updateProfile);
router.delete("/auth/account", authenticate, auth.deleteAccount);

// ---------- Customer ----------
router.get("/bookings", authenticate, requireCustomer, bookings.listMyBookings);
router.post("/bookings", authenticate, requireCustomer, bookings.createBooking);
router.post("/bookings/subscription", authenticate, requireCustomer, subscriptions.createSubscriptionBooking);
router.post("/bookings/:id/checkout", authenticate, requireCustomer, payments.createCheckout);
router.post("/bookings/:id/subscription/checkout", authenticate, requireCustomer, subscriptions.subscriptionCheckout);
router.post("/bookings/:id/subscription/cancel", authenticate, requireCustomer, subscriptions.cancelSubscription);
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

// G1f — non-public groups: owner invite codes + join-by-code.
router.post("/community/groups/join-with-code", authenticate, requireCustomer, groups.joinGroupWithCode);
router.get("/community/groups/:groupId/invite-code", authenticate, requireCustomer, groups.getInviteCode);
router.post("/community/groups/:groupId/invite-code", authenticate, requireCustomer, groups.generateInviteCode);
router.delete("/community/groups/:groupId/invite-code", authenticate, requireCustomer, groups.disableInviteCode);

router.get("/profile", authenticate, requireCustomer, profiles.getOwnProfile);
router.put("/profile", authenticate, requireCustomer, profiles.updateOwnProfile);
router.get("/profile/:userId", authenticate, requireCustomer, profiles.getPublicProfile);

// ---------- Employee ----------
// Every employee route is explicitly `authenticate` + `requireEmployee`. This is
// additive and separate: it does not widen requireCustomer, and an employee
// reaching a customer-only or admin-only route is still denied by that route's
// own guard (employee inherits no customer or admin capability).
// `authenticate` also rejects a disabled account, so a disabled employee's
// already-issued session stops being authorized on its next request.
router.get("/employee/assignments", authenticate, requireEmployee, assignments.listMyAssignments);

// Employee announcements (Phase 2B-2). `authenticate` + `requireEmployee` again,
// so a disabled employee's existing session stops working on its next request
// and a customer/admin is refused before any query runs. The controllers scope
// every read to `audience = "employee"` and to `req.user.id` — no employee id is
// ever accepted from the request, so there is no way to ask for another
// employee's announcements.
router.get("/employee/broadcasts", authenticate, requireEmployee, broadcasts.listMyEmployeeBroadcasts);
router.post(
  "/employee/broadcasts/:id/read",
  authenticate,
  requireEmployee,
  broadcasts.markEmployeeBroadcastRead,
);

// Employee availability + available shifts (Phase 2B-4).
//
// `authenticate` + `requireEmployee` on every one of them, exactly like the
// employee routes above. There is deliberately NO route that takes an employee id
// from the client for a write: the controllers always use `req.user.id`, so
// there is no parameter an employee could change to reach another employee's
// availability or requests. `/employee/shifts/requests` is registered BEFORE
// `/employee/shifts/:id/request` so the literal path can never be captured as an
// `:id` (it would not match anyway — different segment count — but order makes
// the intent explicit).
router.get("/employee/availability", authenticate, requireEmployee, availability.listMyAvailability);
router.post("/employee/availability", authenticate, requireEmployee, availability.createMyAvailability);
router.patch("/employee/availability/:id", authenticate, requireEmployee, availability.updateMyAvailability);
router.delete("/employee/availability/:id", authenticate, requireEmployee, availability.deleteMyAvailability);

router.get("/employee/shifts", authenticate, requireEmployee, shifts.listMyShifts);
router.get("/employee/shifts/requests", authenticate, requireEmployee, shifts.listMyShiftRequests);
router.post("/employee/shifts/:id/request", authenticate, requireEmployee, shifts.requestShift);

// EMPLOYEE LEAVE REQUESTS. A formal request for time off, decided by an admin.
//
// Separate from availability on purpose: availability is the employee's own
// preference ("when I can work") and needs no approval, while leave is a request
// that only an admin may approve or decline. Neither endpoint writes the other, so
// there is no competing source of truth, and neither creates or changes any work.
router.get("/employee/leave", authenticate, requireEmployee, employeeLeave.listMyLeaveRequests);
router.post("/employee/leave", authenticate, requireEmployee, employeeLeave.createMyLeaveRequest);

// Employee community (Phase 2B-5). `authenticate` + `requireEmployee` on both,
// exactly like every employee route above: a disabled employee's existing
// session stops working on its next request, and a customer or admin is refused
// before any query runs. There is deliberately no parameter that names another
// employee, so an employee cannot ask for a colleague's community or post as one.
//
// Both routes live on their own `/employee/community` prefix rather than under
// the customer `/community` prefix, so the two audiences cannot collide on a
// path and the customer routes' requireCustomer guard is never in scope here.
router.get("/employee/community/messages", authenticate, requireEmployee, employeeCommunity.listMyEmployeeCommunityMessages);
router.post("/employee/community/messages", authenticate, requireEmployee, employeeCommunity.createEmployeeCommunityMessage);

// ---------- Admin ----------
const adminOnly = [authenticate, requireAdmin];

router.get("/admin/users", adminOnly, users.adminListUsers);
router.get("/admin/users/:id", adminOnly, users.adminInspectUser);
router.get("/admin/users/:id/brief", adminOnly, users.adminGetCustomer);
router.get("/admin/contacts", adminOnly, users.adminListContactTargets);
router.get("/admin/stats", adminOnly, users.adminStats);

router.get("/admin/bookings", adminOnly, bookings.adminListBookings);
router.patch("/admin/bookings/:id/status", adminOnly, bookings.adminSetBookingStatus);

// Employee accounts. Admin-only: employees are never self-created and never
// self-managed. Disable/reactivate only set/clear User.disabledAt — neither
// deletes the user, so identity, assignments and history are preserved.
router.get("/admin/employees", adminOnly, employees.adminListEmployees);
router.post("/admin/employees", adminOnly, employees.adminCreateEmployee);
router.post("/admin/employees/:id/disable", adminOnly, employees.adminDisableEmployee);
router.post("/admin/employees/:id/reactivate", adminOnly, employees.adminReactivateEmployee);
router.post("/admin/employees/:id/resend-invitation", adminOnly, employees.adminResendEmployeeInvitation);

// Assign an accepted booking to an employee. Writes only BookingAssignment:
// Booking.customerId and Booking.scheduledStartAt are never modified.
router.post("/admin/bookings/:id/assignment", adminOnly, assignments.adminAssignBooking);

// Available shifts + shift requests (Phase 2B-4), all `adminOnly` like every
// other admin route. `/admin/shifts/candidates` is registered before the
// `/admin/shifts/:id` routes for the same explicit-reasoning reason as above.
//
// Approving a request calls the SAME assignment rules as
// /admin/bookings/:id/assignment (shared `applyBookingAssignment`), so an
// approval is never a second, laxer way to assign work.
router.get("/admin/availability", adminOnly, availability.adminListAvailability);

// The admin leave queue. A decision records `decidedAt`/`decidedById` from the
// authenticated session only, can be made exactly once, and never creates, cancels
// or reassigns work of any kind.
router.get("/admin/leave", adminOnly, employeeLeave.adminListLeaveRequests);
router.post("/admin/leave/:id/approve", adminOnly, employeeLeave.adminApproveLeaveRequest);
router.post("/admin/leave/:id/decline", adminOnly, employeeLeave.adminDeclineLeaveRequest);
router.get("/admin/shifts", adminOnly, shifts.adminListShifts);
router.get("/admin/shifts/candidates", adminOnly, shifts.adminListShiftCandidates);
router.post("/admin/shifts", adminOnly, shifts.adminCreateShift);
router.patch("/admin/shifts/:id", adminOnly, shifts.adminUpdateShift);
router.post(
  "/admin/shifts/:id/request/:requestId/approve",
  adminOnly,
  shifts.adminApproveShiftRequest,
);
router.post(
  "/admin/shifts/:id/request/:requestId/decline",
  adminOnly,
  shifts.adminDeclineShiftRequest,
);

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

// Employee community moderation (Phase 2B-5), all `adminOnly` like every other
// admin route. Deliberately NESTED under /admin/community/employee rather than
// sharing the customer community's /admin/community/messages and
// /admin/community/users paths: an admin moderating the employee community gets
// a distinct, audience-pinned surface, so the customer moderation endpoints keep
// exactly the meaning and behavior they already had.
//
// There is NO admin create route. Admins moderate the employee community and
// never author in it — the same rule the customer community has always had.
router.get("/admin/community/employee/messages", adminOnly, employeeCommunity.adminListEmployeeCommunityMessages);
router.delete("/admin/community/employee/messages/:messageId", adminOnly, employeeCommunity.adminDeleteEmployeeCommunityMessage);
router.get("/admin/community/employee/users", adminOnly, employeeCommunity.adminListEmployeeCommunityUsers);
router.post("/admin/community/employee/users/:id/block", adminOnly, employeeCommunity.adminBlockEmployee);
router.post("/admin/community/employee/users/:id/unblock", adminOnly, employeeCommunity.adminUnblockEmployee);

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
