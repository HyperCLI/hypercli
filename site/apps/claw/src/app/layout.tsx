import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { ClawProviders } from "@/components/ClawProviders";

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-plus-jakarta-sans",
});

export const metadata: Metadata = {
  title: "HyperClaw - Unlimited Agent Inference",
  description: "Flat-rate, unlimited LLM inference for AI agents. OpenAI-compatible API on NVIDIA B200 GPUs.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="scroll-smooth">
      <head>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
      </head>
      <body className={`${plusJakartaSans.variable} font-sans antialiased overflow-x-hidden`}>
        <ClawProviders>
          {children}
        </ClawProviders>
      </body>
    </html>
  );
}
