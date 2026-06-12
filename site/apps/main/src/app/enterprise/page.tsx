"use client";

import { useState } from "react";
import {
  ContactModal,
  FeatureGridSection,
  FinalCtaSection,
  Footer,
  Header,
  LongFormText,
  MarketingPageHero,
  NarrativeSplitSection,
} from "@hypercli/shared-ui";

export default function EnterprisePage() {
  const [isContactModalOpen, setIsContactModalOpen] = useState(false);
  const openContactModal = () => setIsContactModalOpen(true);

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main>
        <MarketingPageHero
          title="Enterprise AI, without the infrastructure burden"
          description="HyperCLI gives your teams a secure, scalable platform for LLMs, agents, RAG, media generation, and training — across cloud, on-prem, or air-gapped environments."
          actions={[
            { label: "Talk to Sales", onClick: openContactModal, showArrow: true },
            { label: "Request a Technical Demo", onClick: openContactModal, variant: "secondary" },
          ]}
        />

        <NarrativeSplitSection
          title="Why Enterprises Choose HyperCLI"
          maxWidth="5xl"
          padding="large"
          left={<LongFormText variant="statement">The fastest way to deploy AI at scale.</LongFormText>}
          right={
            <>
              <LongFormText className="mb-5">
                Deploy models in seconds. 90% lower compute cost. Works across any cloud or on-prem. No GPU/K8s expertise required. Global orchestration layer built-in. Security, compliance, governance.
              </LongFormText>
              <LongFormText>HyperCLI accelerates AI adoption across the entire organization.</LongFormText>
            </>
          }
        />

        <NarrativeSplitSection
          title="AI That Runs Anywhere"
          maxWidth="5xl"
          left={<LongFormText variant="statement">Cloud, on-prem, air-gapped, hybrid — we support it all.</LongFormText>}
          right={
            <>
              <LongFormText className="mb-5">
                AWS, GCP, Azure. OCI, sovereign clouds. Private GPU clusters. Data center & colo. Completely air-gapped networks.
              </LongFormText>
              <LongFormText>You choose the environment. HyperCLI orchestrates the workloads.</LongFormText>
            </>
          }
        />

        <FeatureGridSection
          title="Enterprise-Grade Security"
          maxWidth="5xl"
          columns={4}
          statement="Zero-trust architecture. Full isolation. Compliance-ready."
          intro="Security features:"
          items={[
            "SSO / SAML / SCIM",
            "VPC peering (AWS, GCP, Azure)",
            "Private clusters",
            "Zero inbound traffic required",
            "Encrypted data transport",
            "Audit logs",
            "SOC2 / ISO alignment",
            "On-prem + offline mode",
          ]}
          footer={<LongFormText variant="mutedEmphasis">Trusted by enterprise clients requiring strict security boundaries.</LongFormText>}
        />

        <NarrativeSplitSection
          title="AI Use Cases the Enterprise Can Deploy"
          maxWidth="5xl"
          left={<LongFormText variant="statement">HyperCLI supports every modern enterprise AI workload.</LongFormText>}
          right={
            <LongFormText>
              LLMs: Llama, Mistral, GPT-style models. RAG: Enterprise search, knowledge intelligence. Media Gen: Images, video, embeddings. Agents: Tools, retrieval, function calling. Training/Fine-Tuning: LoRA, QLoRA. Pipelines/Flows: Batch, streaming.
            </LongFormText>
          }
        />

        <FeatureGridSection
          title="Observability & Governance"
          maxWidth="5xl"
          columns={4}
          statement="All the guardrails you need."
          intro="Governance features:"
          items={[
            "Cost dashboards",
            "GPU usage insights",
            "Model registry",
            "Audit trails",
            "Secrets management",
            "Role-based access control",
            "Data locality controls",
            "Policy enforcement",
          ]}
          footer={<LongFormText variant="mutedEmphasis">Governance built for Fortune 500 standards.</LongFormText>}
        />

        <FeatureGridSection
          title="Why HyperCLI Beats Cloud Providers"
          maxWidth="5xl"
          checked
          statement="Faster. Cheaper. More flexible. No lock-in."
          intro="Compared to hyperscalers:"
          items={[
            "Deploy 10× faster",
            "Up to 90% cheaper",
            "No heavy K8s ops",
            "No GPU commitment required",
            "No vendor lock-in",
            "Runs on your infrastructure",
          ]}
          footer={<LongFormText variant="mutedEmphasis">HyperCLI simplifies everything between &quot;We want AI&quot; and &quot;It&apos;s in production.&quot;</LongFormText>}
        />

        <NarrativeSplitSection
          title="Scale Across the Organization"
          maxWidth="5xl"
          left={
            <>
              <LongFormText variant="statement" className="mb-8">From a single developer → company-wide platform.</LongFormText>
              <LongFormText variant="emphasis" className="mb-5">Start with:</LongFormText>
              <LongFormText>Innovation teams. Data science. Internal tools. R&D. Prototyping.</LongFormText>
            </>
          }
          right={
            <>
              <LongFormText variant="emphasis" className="mb-5">Scale to:</LongFormText>
              <LongFormText className="mb-10">Customer-facing AI. Production workloads. Global rollouts. Multi-region deployments. Regulated workloads.</LongFormText>
              <LongFormText variant="mutedEmphasis">HyperCLI becomes your AI infrastructure fabric.</LongFormText>
            </>
          }
        />

        <FinalCtaSection
          title="Build your enterprise AI platform on HyperCLI"
          actions={[
            { label: "Talk to Sales", onClick: openContactModal, showArrow: true },
            { label: "See Architecture Diagrams", onClick: openContactModal, variant: "secondary" },
          ]}
        />
      </main>

      <Footer />

      <ContactModal
        isOpen={isContactModalOpen}
        onClose={() => setIsContactModalOpen(false)}
        source="enterprise"
      />
    </div>
  );
}
