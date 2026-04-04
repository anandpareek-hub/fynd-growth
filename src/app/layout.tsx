import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fynd - Growth",
  description: "Preset PostHog funnel, product performance, and revenue insights for Fynd tools.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
