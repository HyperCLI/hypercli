import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { Providers } from "@hypercli/shared-ui";

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-plus-jakarta",
});

export const metadata: Metadata = {
  title: "HyperCLI - Deploy AI models in 30 seconds",
  description: "The universal AI runtime that runs any model across a global GPU fabric with a single command.",
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
        <script src="https://unpkg.com/twemoji@14.0.2/dist/twemoji.min.js" crossOrigin="anonymous"></script>
      </head>
      <body className={`${plusJakartaSans.variable} font-sans antialiased overflow-x-hidden`}>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
