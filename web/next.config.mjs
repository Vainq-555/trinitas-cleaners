/** @type {import('next').NextConfig} */
const nextConfig = {
  // Speed up builds in constrained environments (we deploy via `next start`).
  // Proxy API calls to the Express backend so the JWT cookie stays same-origin.
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.API_URL || "http://localhost:4000"}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;

if (process.env.NODE_ENV === "development") {
  import("@opennextjs/cloudflare").then((m) => m.initOpenNextCloudflareForDev());
}
