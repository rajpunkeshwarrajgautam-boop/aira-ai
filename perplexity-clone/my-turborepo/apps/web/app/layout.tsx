import type { Metadata } from "next";
import localFont from "next/font/local";

import { isOmniRoutePreviewTestAccessEnabled } from "../lib/omniroute-preview-access";
import { Providers } from "./providers";
import "./globals.css";
import "./best-of-premium.css";
import "./impeccable-workspace-v3.css";
import "./claude-workspace.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: "AiraAI — grounded answers with live citations",
  description:
    "Research with live web citations, save persistent threads, and run controlled autonomous tasks from one workspace.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const previewTestAccess = isOmniRoutePreviewTestAccessEnabled();
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}
      >
        <Providers disableAuth={previewTestAccess}>{children}</Providers>
      </body>
    </html>
  );
}
