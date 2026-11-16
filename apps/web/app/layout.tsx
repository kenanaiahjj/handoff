import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AppSplash } from "@/src/components/shell/AppSplash";
import { DeviceCacheRegistration } from "@/src/client/device-cache";
import { UpdateNotice } from "@/src/components/shell/UpdateNotice";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      // The splash script marks returning sessions on <html> before hydration.
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <AppSplash />
        <DeviceCacheRegistration />
        <UpdateNotice />
        {children}
      </body>
    </html>
  );
}
