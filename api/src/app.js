import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import routes from "./routes/index.js";
import { notFound, errorHandler } from "./middleware/error.js";
import { COOKIE_SECURE } from "./config.js";
import { stripeWebhook } from "./controllers/payments.js";

const app = express();

app.set("trust proxy", 1);

// The Next.js app proxies /api to this server, so cookies stay same-origin.
// CORS is still configured for direct/future use.
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "http://localhost:3000",
    credentials: true,
  })
);

// Stripe requires the untouched request bytes for webhook signature checks.
app.post("/api/payments/webhook", express.raw({ type: "application/json" }), stripeWebhook);

app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

app.use("/api", routes);

app.use(notFound);
app.use(errorHandler);

export default app;
