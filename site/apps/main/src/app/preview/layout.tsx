import type { Metadata } from "next"
import { Header, Footer } from "@hypercli/shared-ui"

export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default function PreviewLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="bg-background min-h-screen">
      <Header />
      <main>{children}</main>
      <Footer />
    </div>
  )
}
