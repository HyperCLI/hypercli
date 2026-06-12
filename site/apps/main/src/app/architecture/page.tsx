"use client";

import {
  FeatureGridSection,
  FinalCtaSection,
  Footer,
  Header,
  LongFormText,
  MarketingPageHero,
  NarrativeSplitSection,
} from "@hypercli/shared-ui";

export default function Page() {
  return (
    <div className="bg-background">
      <Header />

      <MarketingPageHero
        title="A Distributed Compute Fabric for Modern AI"
        description="An orchestration engine built for scale, precision, and real workloads."
        secondaryDescription="Inference. Training. Media generation. Agents. Pipelines. Unified under one runtime."
      />

      <NarrativeSplitSection
        title="The Runtime"
        padding="large"
        left={<LongFormText variant="statement">One Interface. Infinite Execution Paths.</LongFormText>}
        right={
          <>
            <LongFormText className="mb-5">Hyper abstracts the complexity of running AI workloads:</LongFormText>
            <LongFormText className="mb-10">
              Containerized execution. Model runtime acceleration. Distributed scheduling. GPU multiplexing. Memory-efficient loading. Intelligent caching.
            </LongFormText>
            <LongFormText variant="emphasis" className="mb-3">Your code becomes a deployable artifact.</LongFormText>
            <LongFormText variant="mutedEmphasis">Hyper handles everything else.</LongFormText>
          </>
        }
      />

      <FeatureGridSection
        title="The Scheduler"
        statement="A Low-Latency, High-Throughput Orchestrator."
        intro="The scheduler continuously evaluates:"
        items={[
          "GPU availability",
          "Model placement",
          "Parallelizable segments",
          "Token throughput",
          "Latency targets",
          "Failure domains",
        ]}
        footer={<LongFormText variant="mutedEmphasis">Workloads are dynamically routed to the optimal hardware in milliseconds.</LongFormText>}
      />

      <NarrativeSplitSection
        title="GPU Fabric"
        left={
          <>
            <LongFormText variant="statement" className="mb-6">A virtualized grid of GPUs.</LongFormText>
            <LongFormText variant="substatement">Elastic. Heterogeneous. Everywhere.</LongFormText>
          </>
        }
        right={
          <>
            <LongFormText className="mb-5">Hyper supports:</LongFormText>
            <LongFormText className="mb-10">
              H100 / A100 / H200 / B200. L40S / L4 / older architectures. Mixed fleets. Shared nodes. Fractional GPUs. Multi-DC routing.
            </LongFormText>
            <LongFormText variant="emphasis" className="mb-3">The physical limits disappear.</LongFormText>
            <LongFormText variant="mutedEmphasis">The fabric handles the rest.</LongFormText>
          </>
        }
      />

      <FeatureGridSection
        title="Model Optimization"
        statement="Performance through specialization."
        intro="Hyper integrates the best model-acceleration stacks:"
        items={[
          "vLLM",
          "SGLang",
          "TensorRT-LLM",
          "GGUF / AWQ / GPTQ",
          "Speculative decoding",
          "Quantization-aware workloads",
        ]}
        footer={
          <>
            <LongFormText variant="emphasis" className="mb-3">Everything runs at peak efficiency.</LongFormText>
            <LongFormText variant="mutedEmphasis">Without manual tuning.</LongFormText>
          </>
        }
      />

      <FeatureGridSection
        title="Autoscaling"
        statement="Predictive scaling for unpredictable workloads."
        intro="Hyper anticipates demand:"
        items={[
          "Pre-warms models",
          "Manages cold starts",
          "Predicts concurrency",
          "Allocates fractional GPUs",
          "Prunes idle nodes",
          "Stabilizes latency",
        ]}
        footer={<LongFormText variant="mutedEmphasis">Capacity grows and contracts with workload pressure.</LongFormText>}
      />

      <NarrativeSplitSection
        title="Multi-Environment Execution"
        left={
          <>
            <LongFormText variant="statement" className="mb-6">Cloud. On-prem. Air-gapped.</LongFormText>
            <LongFormText variant="substatement">One runtime across all environments.</LongFormText>
          </>
        }
        right={
          <>
            <LongFormText className="mb-5">The architecture supports:</LongFormText>
            <LongFormText className="mb-10">
              Private GPU clusters. Sovereign deployments. Regulated workloads. Multi-region failover. Zero-trust boundaries.
            </LongFormText>
            <LongFormText variant="mutedEmphasis">Every environment behaves like part of the same system.</LongFormText>
          </>
        }
      />

      <FeatureGridSection
        title="Observability"
        statement="Visibility into every token and thread."
        items={[
          "Job timelines",
          "Resource allocation",
          "Latency breakdowns",
          "Model logs",
          "GPU metrics",
          "Cost insights",
        ]}
        footer={<LongFormText variant="mutedEmphasis">The fabric is opaque to manage, but transparent to observe.</LongFormText>}
      />

      <FinalCtaSection
        title="The Fabric Awaits."
        actions={[{ label: "See the Architecture in Action", showArrow: true }]}
      />

      <Footer />
    </div>
  );
}
