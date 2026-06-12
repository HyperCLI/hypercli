"use client";

import { useRef } from "react";
import { motion, useInView } from "framer-motion";
import { Zap, Gauge, Plug } from "lucide-react";
import { CodeSnippetCard, MarketingSection, SectionHeading, SpecCard } from "@hypercli/shared-ui";

const specs = [
  {
    icon: Zap,
    label: "Throughput",
    value: "~36M",
    unit: "tokens/hour per AIU",
    description: "Sustained throughput with 4x burst on frontier models",
  },
  {
    icon: Gauge,
    label: "Rate Limits",
    value: "600K TPM",
    unit: "/ 3,000 RPM per AIU",
    description: "Base rate per AIU with 4x burst capacity. Scales linearly with AIUs.",
  },
  {
    icon: Plug,
    label: "Compatibility",
    value: "OpenAI",
    unit: "SDK compatible",
    description: "Works with any client that speaks the OpenAI Chat Completions API",
  },
];

const sdkSnippet = `from openai import OpenAI

client = OpenAI(
    base_url="https://api.hypercli.com/v1",
    api_key="YOUR_API_KEY",
)

response = client.chat.completions.create(
    model="kimi-k2.5",
    messages=[{"role": "user", "content": "Hello!"}],
)
print(response.choices[0].message.content)`;

export function TechSpecsSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const isInView = useInView(sectionRef, { once: true, margin: "-100px" });

  return (
    <MarketingSection
      ref={sectionRef}
      background="secondary"
    >
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 40 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          className="mb-16"
        >
          <SectionHeading
            title="Technical"
            accent="Specifications"
            description="Enterprise-grade infrastructure built for autonomous AI workloads."
          />
        </motion.div>

        <div className="grid lg:grid-cols-2 gap-12 items-start">
          <div className="space-y-4">
            {specs.map((spec, index) => (
              <SpecCard
                key={spec.label}
                icon={spec.icon}
                value={spec.value}
                unit={spec.unit}
                description={spec.description}
                reveal={isInView}
                index={index}
              />
            ))}
          </div>

          <motion.div
            initial={{ opacity: 0, x: 30 }}
            animate={
              isInView ? { opacity: 1, x: 0 } : { opacity: 0, x: 30 }
            }
            transition={{
              duration: 0.8,
              delay: 0.3,
              ease: [0.22, 1, 0.36, 1],
            }}
          >
            <CodeSnippetCard label="example.py" code={sdkSnippet} />
          </motion.div>
        </div>
    </MarketingSection>
  );
}
