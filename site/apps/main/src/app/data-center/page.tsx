"use client";

import { useState } from "react";
import {
  CodeSnippetCard,
  ContactModal,
  FeatureGridSection,
  FinalCtaSection,
  Footer,
  Header,
  LongFormText,
  MarketingPageHero,
  NarrativeSplitSection,
} from "@hypercli/shared-ui";

export default function DataCenterPage() {
  const [isContactModalOpen, setIsContactModalOpen] = useState(false);
  const openContactModal = () => setIsContactModalOpen(true);

  return (
    <div className="min-h-screen overflow-x-hidden bg-background">
      <Header />

      <MarketingPageHero
        title="Turn idle GPUs into revenue with one command"
        description="HyperCLI is the easiest way for data centers to monetize unused GPU capacity. No SLAs, no commitments, no engineering required."
        actions={[
          { label: "Get the Data Center Deck", onClick: openContactModal, showArrow: true },
          { label: "Talk to Infrastructure Partnerships", onClick: openContactModal, variant: "secondary" },
        ]}
      />

      <NarrativeSplitSection
        title="The Data Center Opportunity"
        padding="large"
        left={<LongFormText variant="statement">Your GPUs sit idle more than they earn. HyperCLI changes that.</LongFormText>}
        right={
          <>
            <LongFormText className="mb-5">
              Data centers face: Idle GPU hours. Underutilized racks. Clients with unpredictable workloads. Low margins on traditional hosting. High overhead for GPU operations.
            </LongFormText>
            <LongFormText variant="emphasis">
              HyperCLI solves all of this <span className="text-primary">instantly</span>.
            </LongFormText>
          </>
        }
      />

      <FeatureGridSection
        title="One Command Integration"
        statement="Run one Docker container. Start earning."
        beforeGrid={
          <CodeSnippetCard
            label="terminal"
            code="$ docker run hyperdc/agent"
            className="mb-12 max-w-3xl"
          />
        }
        items={[
          "Auto-discovers GPUs",
          "Validates hardware",
          "Connects securely",
          "Makes nodes job-ready",
          "Requires no inbound traffic",
          "Starts routing workloads immediately",
        ]}
        footer={
          <LongFormText variant="mutedEmphasis">
            Online in under <span className="text-primary">60 seconds</span>.
          </LongFormText>
        }
      />

      <FeatureGridSection
        title="No SLAs. No Commitments. Zero Risk."
        columns={4}
        checked
        statement="Connect whenever. Disconnect anytime."
        intro="Unlike GPU marketplaces, HyperCLI requires:"
        items={[
          "No uptime guarantees",
          "No capacity commitments",
          "No reservations",
          "No listing overhead",
          "No support burden",
          "No penalties",
          "No lock-in",
        ]}
        footer={<LongFormText variant="mutedEmphasis">Revenue only when you choose to be available.</LongFormText>}
      />

      <FeatureGridSection
        title="HyperCLI Handles Everything"
        columns={4}
        statement="Your GPUs. Our orchestration. No operational burden."
        intro="We manage:"
        items={[
          "Scheduling",
          "Routing",
          "Autoscaling",
          "GPU splitting",
          "Model placement",
          "Failover",
          "Billing + metering",
          "Isolation & security",
        ]}
        footer={
          <div className="grid items-start gap-x-16 gap-y-8 md:grid-cols-2">
            <LongFormText variant="emphasis">You provide hardware</LongFormText>
            <LongFormText variant="emphasis">We handle the workloads</LongFormText>
          </div>
        }
      />

      <NarrativeSplitSection
        title="Any GPU, Any Configuration"
        left={<LongFormText variant="statement">Monetize H100s, A100s, L40S, H200, B200 — or mixed fleets.</LongFormText>}
        right={
          <>
            <LongFormText className="mb-5">
              Legacy + modern GPUs. Multi-tenant setups. Fractional GPU use. Heterogeneous clusters. Bare-metal or virtualized.
            </LongFormText>
            <LongFormText>If it runs Docker, it can earn.</LongFormText>
          </>
        }
      />

      <NarrativeSplitSection
        title="Enterprise Workloads Delivered to You"
        left={<LongFormText variant="statement">HyperCLI brings the demand. You earn the revenue.</LongFormText>}
        right={
          <>
            <LongFormText className="mb-5">
              LLM inference. Media generation. Agents / toolcalling. Fine-tuning. Training. Batch pipelines.
            </LongFormText>
            <LongFormText>No need for a sales team — we supply the jobs.</LongFormText>
          </>
        }
      />

      <FeatureGridSection
        title="Revenue Model"
        statement="Recurring payouts with full transparency."
        intro="You earn:"
        items={[
          "A share of compute revenue",
          "Monthly payouts",
          "Per-job metering",
          "Dashboard visibility",
          "No overhead, no humans required",
        ]}
        footer={
          <LongFormText variant="emphasis" className="text-2xl">
            100 H100s can generate <span className="text-primary">~$700k/year</span> in DC share
          </LongFormText>
        }
      />

      <NarrativeSplitSection
        title="Perfect for All Data Center Types"
        left={<LongFormText variant="statement">If you have GPUs, you can earn.</LongFormText>}
        right={<LongFormText>Regional colos. GPU hosting providers. HPC centers. Sovereign cloud. Private cloud. Research labs.</LongFormText>}
      />

      <FinalCtaSection
        title="Monetize your GPUs with one command"
        actions={[
          { label: "Get the Data Center Deck", onClick: openContactModal, showArrow: true },
          { label: "Schedule a Technical Call", onClick: openContactModal, variant: "secondary" },
        ]}
      />

      <Footer />

      <ContactModal
        isOpen={isContactModalOpen}
        onClose={() => setIsContactModalOpen(false)}
        source="data-center"
      />
    </div>
  );
}
