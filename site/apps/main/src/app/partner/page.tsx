"use client";

import { useState } from "react";
import {
  FeatureGridSection,
  FinalCtaSection,
  Footer,
  Header,
  LongFormText,
  MarketingPageHero,
  NarrativeSplitSection,
  PartnerFormModal,
} from "@hypercli/shared-ui";

export default function PartnerPage() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const openPartnerModal = () => setIsModalOpen(true);

  return (
    <div className="min-h-screen overflow-x-hidden bg-background">
      {/* Hidden form for Netlify to detect at build time */}
      <form name="partner-inquiry" data-netlify="true" netlify-honeypot="bot-field" hidden>
        <input type="hidden" name="form-name" value="partner-inquiry" />
        <input name="bot-field" />
        <input name="name" />
        <input name="email" />
        <input name="company" />
        <input name="role" />
        <input name="companySize" />
        <textarea name="message" />
      </form>

      <Header />

      <main>
        <MarketingPageHero
          title="A New Revenue Layer for AI."
          description="Deliver full AI systems to your clients. No infrastructure. No engineering. Just profit."
          actions={[{ label: "Become a Partner", onClick: openPartnerModal, showArrow: true }]}
        />

        <NarrativeSplitSection
          title="The Shift"
          padding="large"
          left={<LongFormText variant="statement">AI is here. Infrastructure is not.</LongFormText>}
          right={
            <>
              <LongFormText className="mb-4">
                Your clients want: LLMs. Agents. RAG pipelines. Media generation. Training.
              </LongFormText>
              <LongFormText className="mb-10">
                But the infrastructure is slow, brittle, complex, and costly.
              </LongFormText>
              <LongFormText variant="emphasis">This is where HyperCLI enters.</LongFormText>
            </>
          }
        />

        <NarrativeSplitSection
          title="What HyperCLI Enables"
          left={<LongFormText variant="statement">Deploy AI workloads in minutes. Sell them for years.</LongFormText>}
          right={
            <>
              <LongFormText className="mb-5">
                You deliver: Production-ready AI clusters. Inference at scale. Fine-tuning systems. Enterprise search. Agentic workflows. GPU orchestration. On-prem, hybrid, or cloud deployments.
              </LongFormText>
              <LongFormText>Without building or operating any of it.</LongFormText>
            </>
          }
        />

        <FeatureGridSection
          title="The Revenue Model"
          statement="AI that pays you back. Every month."
          intro="Three streams:"
          itemVariant="custom"
          items={[
            <div key="resell-margin">
              <p className="mb-3 text-xl leading-relaxed text-foreground">
                <span className="text-primary">1.</span> Resell Margin
              </p>
              <p className="leading-relaxed text-text-secondary">20–40% on every HyperCLI deployment.</p>
            </div>,
            <div key="compute-share">
              <p className="mb-3 text-xl leading-relaxed text-foreground">
                <span className="text-primary">2.</span> Compute Share
              </p>
              <p className="leading-relaxed text-text-secondary">A percentage of all GPU usage across your clients.</p>
            </div>,
            <div key="managed-services">
              <p className="mb-3 text-xl leading-relaxed text-foreground">
                <span className="text-primary">3.</span> Managed Services
              </p>
              <p className="leading-relaxed text-text-secondary">Monitoring. Optimization. Governance. Your expertise layered over our runtime.</p>
            </div>,
          ]}
          footer={<LongFormText variant="mutedEmphasis">Recurring revenue. Predictable margin. Zero infrastructure burden.</LongFormText>}
        />

        <NarrativeSplitSection
          title="The Platform"
          left={<LongFormText variant="statement">Your clients get the fabric. You get the credit.</LongFormText>}
          right={
            <>
              <LongFormText className="mb-5">
                HyperCLI becomes your AI runtime: GPU scheduling. Autoscaling. Distributed execution. Model routing. Container isolation. Observability. Deployment blueprints.
              </LongFormText>
              <LongFormText>Delivered through your brand. Powered by our engine.</LongFormText>
            </>
          }
        />

        <NarrativeSplitSection
          title="The Console"
          left={<LongFormText variant="statement">Multi-client control. Zero-touch operations.</LongFormText>}
          right={
            <>
              <LongFormText className="mb-5">
                One dashboard for: Deployments. Clusters. Model endpoints. Usage. Cost. Policies. Logs.
              </LongFormText>
              <LongFormText>You manage outcomes. HyperCLI handles orchestration.</LongFormText>
            </>
          }
        />

        <NarrativeSplitSection
          title="GTM Alignment"
          padding="large"
          left={<LongFormText variant="statement">We don&apos;t compete with you. We scale you.</LongFormText>}
          right={
            <>
              <LongFormText className="mb-5">
                Partners receive: Lead sharing. Co-selling. Architecture support. Pilot assistance. Partner playbooks. Priority integration. Dedicated enablement.
              </LongFormText>
              <LongFormText>You own the relationship. We power the infrastructure.</LongFormText>
            </>
          }
        />

        <FinalCtaSection
          title="Sell AI infrastructure without building it."
          actions={[{ label: "Join the Partner Network", onClick: openPartnerModal, showArrow: true }]}
        />
      </main>

      <Footer />

      <PartnerFormModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </div>
  );
}
