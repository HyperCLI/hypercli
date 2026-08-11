import type { Metadata, Viewport } from "next";
import { Figtree } from "next/font/google";
import "./globals.css";
import { ClawProviders } from "@/components/ClawProviders";
import { ThemeScript } from "@hypercli/shared-ui";

const figtree = Figtree({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-figtree",
});

export const metadata: Metadata = {
  title: "HyperCLI - Unlimited Agent Inference",
  description: "Flat-rate, unlimited LLM inference for AI agents. OpenAI-compatible API on NVIDIA B300 GPUs.",
  manifest: "/site.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico?v=aurora1" },
      { url: "/favicon-16x16.png?v=aurora1", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png?v=aurora1", sizes: "32x32", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png?v=aurora1", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  interactiveWidget: "resizes-visual",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="scroll-smooth" data-theme="aurora-dark" data-color-mode="dark" data-plan-tier="solo" suppressHydrationWarning>
      <head>
        <link rel="icon" href="/favicon.ico?v=aurora1" sizes="any" />
        <link rel="icon" href="/favicon-32x32.png?v=aurora1" type="image/png" sizes="32x32" />
        <link rel="icon" href="/favicon-16x16.png?v=aurora1" type="image/png" sizes="16x16" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png?v=aurora1" sizes="180x180" />
        <link rel="manifest" href="/site.webmanifest" />
        <ThemeScript />
      </head>
      <body
        className={`${figtree.variable} font-sans antialiased overflow-x-hidden`}
        suppressHydrationWarning
      >
        <ClawProviders>
          {children}
        </ClawProviders>
      </body>
    </html>
  );
}
