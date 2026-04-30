import type { ReactNode } from "react";
import { DevAgentSetupHeader } from "./DevAgentSetupHeader";

export default function DevAgentSetupLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-background">
      <DevAgentSetupHeader />
      <main className="mx-auto max-w-[1400px] px-4 pb-10 pt-24 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}
