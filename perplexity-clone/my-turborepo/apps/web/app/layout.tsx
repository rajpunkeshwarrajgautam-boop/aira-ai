import type { Metadata } from "next";
import localFont from "next/font/local";
import { Playfair_Display } from "next/font/google";

import { Providers } from "./providers";
import "./globals.css";
import "./best-of-premium.css";
import "./impeccable-workspace-v3.css";
import "./aira-intelligence-os.css";
import "./aira-visual-redesign.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
});
const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-playfair",
});

export const metadata: Metadata = {
  title: "AiraAI — grounded answers with live citations",
  description:
    "Research with live web citations, save persistent threads, and run controlled autonomous tasks from one workspace.",
};

import { AiraPreloader } from "../components/AiraPreloader";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                if (sessionStorage.getItem('aira-visited')) {
                  document.documentElement.classList.add('skip-preloader');
                }
              } catch (e) {}
            `,
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${playfair.variable} font-sans antialiased`}
      >
        <AiraPreloader />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
