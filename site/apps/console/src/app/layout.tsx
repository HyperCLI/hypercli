import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { AuthRouteBoundary, Providers, ThemeScript } from "@hypercli/shared-ui";

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-plus-jakarta-sans",
});

export const metadata: Metadata = {
  title: "HyperCLI Console",
  description: "Manage your AI infrastructure",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="scroll-smooth" data-theme="dark" suppressHydrationWarning>
      <head>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <ThemeScript />
      </head>
      <body className={`${plusJakartaSans.variable} font-sans antialiased overflow-x-hidden`} suppressHydrationWarning>
        <Providers>
          <AuthRouteBoundary
            publicPaths={["/"]}
            unauthenticatedRedirectTo="/"
            authenticatedPublicRedirectTo="/dashboard"
          >
            {children}
          </AuthRouteBoundary>
        </Providers>
        <Script src="https://unpkg.com/twemoji@14.0.2/dist/twemoji.min.js" crossOrigin="anonymous" strategy="afterInteractive" />
      </body>
    </html>
  );
}
