/** @type {import('next').NextConfig} */
const apiOrigin =
  process.env.NODE_ENV === "production"
    ? "https://api.trinitaso.com"
    : process.env.API_URL || "http://localhost:4000";

const nextConfig = {
  // Speed up builds in constrained environments (we deploy via `next start`).
  // Proxy API calls to the Express backend so the JWT cookie stays same-origin.
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiOrigin}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;

if (process.env.NODE_ENV === "development") {
  import("@opennextjs/cloudflare").then((m) => m.initOpenNextCloudflareForDev());
}
