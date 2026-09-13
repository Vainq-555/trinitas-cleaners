import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const adminPassword = await bcrypt.hash("Admin123!", 10);
  const custPassword = await bcrypt.hash("Customer123!", 10);

  const admin = await prisma.user.upsert({
    where: { email: "admin@trinitascleaners.com" },
    update: {},
    create: {
      email: "admin@trinitascleaners.com",
      passwordHash: adminPassword,
      name: "Trinitas Admin",
      phone: "1 763-620-4955",
      role: "admin",
      status: "offline",
    },
  });

  const customer = await prisma.user.upsert({
    where: { email: "customer@example.com" },
    update: {},
    create: {
      email: "customer@example.com",
      passwordHash: custPassword,
      name: "Jordan Sample",
      phone: "612-555-0100",
      address: "1420 Main St, Anoka, MN 55303",
      role: "customer",
      status: "offline",
    },
  });

  const services = [
    {
      name: "Window Cleaning — Interior",
      description:
        "Streak-free interior window cleaning for homes and businesses. Includes sills and tracks.",
      basePrice: 12.0,
    },
    {
      name: "Window Cleaning — Exterior",
      description:
        "Professional exterior window washing. Reachable windows only, screens removed and cleaned.",
      basePrice: 15.0,
    },
    {
      name: "Full Window Package (In & Out)",
      description:
        "Complete interior and exterior window service at a bundled rate.",
      basePrice: 25.0,
    },
    {
      name: "Screen Cleaning",
      description:
        "Screen removal, washing, and reinstallation. Screens on a 4-window package included free.",
      basePrice: 3.0,
    },
    {
      name: "Carpet Cleaning",
      description:
        "Hot-water extraction carpet cleaning. Price per room, minimum two rooms.",
      basePrice: 40.0,
    },
    {
      name: "Pressure Washing",
      description:
        "Driveways, walkways, and patios. Rate per 500 sq. ft.",
      basePrice: 65.0,
    },
  ];

  for (const s of services) {
    await prisma.service.upsert({
      where: { id: `seed-${s.name}` },
      update: {},
      create: { id: `seed-${s.name}`, ...s },
    });
  }

  const service = await prisma.service.findFirst({
    where: { name: "Window Cleaning — Interior" },
  });

  if (service) {
    await prisma.booking.upsert({
      where: { id: "seed-booking-1" },
      update: {},
      create: {
        id: "seed-booking-1",
        customerId: customer.id,
        serviceId: service.id,
        date: new Date(Date.now() + 7 * 86400000),
        note: "2 story, 12 windows",
        status: "accepted",
        price: 12,
      },
    });
  }

  await prisma.broadcast.upsert({
    where: { id: "seed-announcement-1" },
    update: {},
    create: {
      id: "seed-announcement-1",
      type: "announcement",
      target: "public",
      title: "Welcome to Trinitas-Cleaners",
      content:
        "We are now booking spring window cleaning in the Anoka area. Call 1 763-620-4955 to schedule!",
    },
  });

  const howItWorksSections = [
    {
      id: "seed-content-hiw-account",
      page: "how-it-works",
      sectionKey: "create-account",
      title: "Step 1 \u2014 Create an account",
      body: "Create a free account with your name, email, and password. Your account lets you request services, track bookings, and receive updates.",
      order: 10,
      isActive: true,
    },
    {
      id: "seed-content-hiw-request",
      page: "how-it-works",
      sectionKey: "request-service",
      title: "Step 2 \u2014 Request a service",
      body: "Choose a service and a date, then submit your request. A Trinitas-Cleaners representative reviews every request before confirming it.",
      order: 20,
      isActive: true,
    },
    {
      id: "seed-content-hiw-approval",
      page: "how-it-works",
      sectionKey: "approval",
      title: "Step 3 \u2014 Get approved",
      body: "Accepted requests move forward. If a request cannot be accepted, it is declined and you can reach out through your dashboard for help.",
      order: 30,
      isActive: true,
    },
    {
      id: "seed-content-hiw-payment",
      page: "how-it-works",
      sectionKey: "payment",
      title: "Step 4 \u2014 Pay for your service",
      body: "Online payments are handled by a secure checkout that becomes available once your request is accepted. Cash payments are arranged directly with Trinitas-Cleaners.",
      order: 40,
      isActive: true,
    },
    {
      id: "seed-content-hiw-receipt",
      page: "how-it-works",
      sectionKey: "receipt",
      title: "Step 5 \u2014 Get your receipt",
      body: "A receipt is issued for every completed payment and is available in your dashboard.",
      order: 50,
      isActive: true,
    },
  ];

  for (const s of howItWorksSections) {
    await prisma.contentSection.upsert({
      where: { id: s.id },
      update: {},
      create: s,
    });
  }

  console.log("Seeded admin: admin@trinitascleaners.com / Admin123!");
  console.log("Seeded customer: customer@example.com / Customer123!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
