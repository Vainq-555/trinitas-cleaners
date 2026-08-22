import "./globals.css";
import { AuthProvider } from "@/lib/auth";

export const metadata = {
  title: "Trinitas-Cleaners | Professional Cleaning in Anoka, MN",
  description:
    "Professional window cleaning, screen cleaning, and more in Anoka, Minnesota. Streak-free guarantees, transparent pricing, and easy online booking. Call 1 763-620-4955.",
  applicationName: "Trinitas-Cleaners",
  keywords: ["window cleaning", "screen cleaning", "Anoka MN", "Trinitas-Cleaners", "cleaning service"],
  openGraph: {
    title: "Trinitas-Cleaners | Professional Cleaning in Anoka, MN",
    description: "Window cleaning, screen cleaning, and more — locally owned in Anoka, MN 55303.",
    type: "website",
    locale: "en_US",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-canvas">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}