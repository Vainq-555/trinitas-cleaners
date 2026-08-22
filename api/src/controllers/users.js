import prisma from "../utils/prisma.js";

const publicUser = (u) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  phone: u.phone,
  address: u.address,
  role: u.role,
  status: u.status,
  lastActiveAt: u.lastActiveAt,
});

// Dashboard & user monitoring: who is logged in/out, online/offline.
export async function adminListUsers(req, res) {
  const users = await prisma.user.findMany({
    where: { role: "customer" },
    orderBy: [{ status: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      address: true,
      status: true,
      lastActiveAt: true,
      createdAt: true,
      _count: { select: { bookings: true, receipts: true, messagesSent: true } },
    },
  });
  res.json({ users });
}

/**
 * Account impersonation/inspection: view a customer's full dashboard data
 * (bookings, services+personalized prices, receipts) without their password.
 */
export async function adminInspectUser(req, res) {
  const { id } = req.params;
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return res.status(404).json({ error: "User not found" });
  if (user.role === "admin") return res.status(400).json({ error: "Target is not a customer" });

  const [bookings, receipts, messages] = await Promise.all([
    prisma.booking.findMany({
      where: { customerId: id },
      orderBy: { createdAt: "desc" },
      include: { service: true },
    }),
    prisma.receipt.findMany({
      where: { customerId: id },
      orderBy: { createdAt: "desc" },
      include: { booking: { include: { service: true } } },
    }),
    prisma.message.findMany({
      where: { OR: [{ senderId: id }, { receiverId: id }] },
      orderBy: { createdAt: "asc" },
      include: { sender: { select: { id: true, name: true, role: true } } },
    }),
  ]);

  // Personalized prices for this customer (custom overrides + base prices).
  const services = await prisma.service.findMany({ where: { isActive: true } });
  const overrides = await prisma.customPrice.findMany({ where: { customerId: id } });
  const overrideMap = new Map(overrides.map((o) => [o.serviceId, o.price]));
  const serviceCatalog = services.map((s) => ({
    ...s,
    price: overrideMap.get(s.id) ?? s.basePrice,
    personalized: overrideMap.has(s.id),
  }));

  res.json({
    user: publicUser(user),
    serviceCatalog,
    bookings,
    receipts,
    messages,
  });
}

export async function adminGetCustomer(req, res) {
  const { id } = req.params;
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ user: publicUser(user) });
}

// Minimal contact target list for admin messaging.
export async function adminListContactTargets(req, res) {
  const users = await prisma.user.findMany({ where: { role: "customer" } });
  res.json({ users: users.map(publicUser) });
}

// Simple admin stats for the dashboard header.
export async function adminStats(req, res) {
  const [online, totalCustomers, pending, worked, declined] = await Promise.all([
    prisma.user.count({ where: { role: "customer", status: "online" } }),
    prisma.user.count({ where: { role: "customer" } }),
    prisma.booking.count({ where: { status: "pending" } }),
    prisma.booking.count({ where: { status: "worked" } }),
    prisma.booking.count({ where: { status: "declined" } }),
  ]);
  res.json({ online, totalCustomers, pending, worked, declined });
}