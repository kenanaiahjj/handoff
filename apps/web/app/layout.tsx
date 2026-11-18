import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { AppSplash } from "@/src/components/shell/AppSplash";
import { DeviceCacheRegistration } from "@/src/client/device-cache";
import { UpdateNotice } from "@/src/components/shell/UpdateNotice";
import { AppBadgeSync } from "@/src/components/shell/AppBadgeSync";
import { CanvasNavigationOverlay } from "@/src/components/shell/CanvasNavigationOverlay";

// Asbir's own typefaces, served from the app (Latin subset of Asbir Sans; variable Asbir Mono).
const asbirSans = localFont({
  variable: "--font-asbir-sans",
  display: "swap",
  src: [
    { path: "./fonts/AsbirSans-Regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/AsbirSans-Medium.woff2", weight: "500", style: "normal" },
    { path: "./fonts/AsbirSans-SemiBold.woff2", weight: "600", style: "normal" },
    { path: "./fonts/AsbirSans-Bold.woff2", weight: "700", style: "normal" },
  ],
  fallback: ["system-ui", "-apple-system", "Helvetica Neue", "sans-serif"],
});

const asbirMono = localFont({
  variable: "--font-asbir-mono",
  display: "swap",
  src: [{ path: "./fonts/AsbirMono-Variable.woff2", weight: "100 900", style: "normal" }],
  fallback: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
});

export const metadata: Metadata = {
  title: "Asbir Handoff",
  description: "Review versioned design handoffs with your team.",
  applicationName: "Asbir Handoff",
  appleWebApp: {
    capable: true,
    title: "Asbir Handoff",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icons/asbir-handoff-v3-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/asbir-handoff-v3-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/asbir-handoff-v3-180.png", sizes: "180x180", type: "image/png" }],
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${asbirSans.variable} ${asbirMono.variable} h-full antialiased`}
      // The splash script marks returning sessions on <html> before hydration.
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <AppSplash />
        <DeviceCacheRegistration />
        <UpdateNotice />
        <AppBadgeSync />
        <CanvasNavigationOverlay />
        {children}
      </body>
    </html>
  );
}
