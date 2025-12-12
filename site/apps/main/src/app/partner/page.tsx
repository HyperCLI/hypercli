"use client";

import { ArrowRight } from "lucide-react";
import { motion } from "framer-motion";
import { Header } from "@hypercli/shared-ui";

export default function PartnerPage() {
  return (
    <div className="bg-[#0B0D0E] min-h-screen overflow-x-hidden">
      <Header />
      <main className="pt-16">
        {/* Hero Section */}
        <section className="relative pt-32 pb-24 px-4 sm:px-6 lg:px-8 bg-[#0B0D0E]">
          <motion.div
            className="max-w-5xl mx-auto"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <h1 className="text-6xl sm:text-7xl lg:text-8xl text-white mb-8 leading-[1.1] tracking-tight max-w-4xl">
              A New Revenue Layer for AI.
            </h1>

            <p className="text-2xl text-[#9BA0A2] leading-relaxed mb-10 max-w-2xl">
              Deliver full AI systems to your clients. No
              infrastructure. No engineering. Just profit.
            </p>

            <button className="px-8 py-4 bg-[#38D39F] text-[#0B0D0E] rounded-lg hover:bg-[#45E4AE] transition-colors flex items-center gap-2">
              Become a Partner
              <ArrowRight className="w-5 h-5" />
            </button>
          </motion.div>
        </section>
       </main>
      {/* The Shift */}
      <section className="pt-32 pb-32 px-4 sm:px-6 lg:px-8 bg-[#0B0D0E] border-t border-[#2A2D2F]/30">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <h2 className="text-5xl text-white mb-12 tracking-tight">
              The Shift
            </h2>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-x-16 gap-y-8 items-start">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.2 }}
            >
              <p className="text-3xl text-white leading-tight">
                AI is here. Infrastructure is not.
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.3 }}
            >
              <p className="text-lg text-[#9BA0A2] mb-4 leading-relaxed">
                Your clients want: LLMs. Agents. RAG pipelines.
                Media generation. Training.
              </p>

              <p className="text-lg text-[#9BA0A2] mb-10 leading-relaxed">
                But the infrastructure is slow, brittle,
                complex, and costly.
              </p>

              <p className="text-xl text-white leading-relaxed">
                This is where HyperCLI enters.
              </p>
            </motion.div>
          </div>
        </div>
      </section>

      {/* What HyperCLI Enables */}
      <section className="pt-20 pb-20 px-4 sm:px-6 lg:px-8 bg-[#0B0D0E] border-t border-[#2A2D2F]/30">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <h2 className="text-5xl text-white mb-12 tracking-tight">
              What HyperCLI Enables
            </h2>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-x-16 gap-y-8 items-start">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.2 }}
            >
              <p className="text-3xl text-white leading-tight">
                Deploy AI workloads in minutes. Sell them for
                years.
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.3 }}
            >
              <p className="text-lg text-[#9BA0A2] mb-5 leading-relaxed">
                You deliver: Production-ready AI clusters.
                Inference at scale. Fine-tuning systems.
                Enterprise search. Agentic workflows. GPU
                orchestration. On-prem, hybrid, or cloud
                deployments.
              </p>
              <p className="text-lg text-[#9BA0A2] leading-relaxed">
                Without building or operating any of it.
              </p>
            </motion.div>
          </div>
        </div>
      </section>

      {/* The Revenue Model */}
      <section className="pt-20 pb-20 px-4 sm:px-6 lg:px-8 bg-[#0B0D0E] border-t border-[#2A2D2F]/30">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <h2 className="text-5xl text-white mb-12 tracking-tight">
              The Revenue Model
            </h2>

            <p className="text-3xl text-white mb-10 leading-tight">
              AI that pays you back. Every month.
            </p>

            <p className="text-lg text-[#9BA0A2] mb-8 leading-relaxed">
              Three streams:
            </p>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-6 mb-10">
            <motion.div
              className="p-6 border border-[#2A2D2F]/50 rounded-lg"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.1 }}
            >
              <p className="text-xl text-white mb-3">
                <span className="text-[#38D39F]">1.</span>{" "}
                Resell Margin
              </p>
              <p className="text-[#9BA0A2] leading-relaxed">
                20–40% on every HyperCLI deployment.
              </p>
            </motion.div>

            <motion.div
              className="p-6 border border-[#2A2D2F]/50 rounded-lg"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.2 }}
            >
              <p className="text-xl text-white mb-3">
                <span className="text-[#38D39F]">2.</span>{" "}
                Compute Share
              </p>
              <p className="text-[#9BA0A2] leading-relaxed">
                A percentage of all GPU usage across your
                clients.
              </p>
            </motion.div>

            <motion.div
              className="p-6 border border-[#2A2D2F]/50 rounded-lg"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.3 }}
            >
              <p className="text-xl text-white mb-3">
                <span className="text-[#38D39F]">3.</span>{" "}
                Managed Services
              </p>
              <p className="text-[#9BA0A2] leading-relaxed">
                Monitoring. Optimization. Governance. Your
                expertise layered over our runtime.
              </p>
            </motion.div>
          </div>

          <motion.p
            className="text-xl text-[#D4D6D7] leading-relaxed"
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.4 }}
          >
            Recurring revenue. Predictable margin. Zero
            infrastructure burden.
          </motion.p>
        </div>
      </section>

      {/* The Platform */}
      <section className="pt-20 pb-20 px-4 sm:px-6 lg:px-8 bg-[#0B0D0E] border-t border-[#2A2D2F]/30">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <h2 className="text-5xl text-white mb-12 tracking-tight">
              The Platform
            </h2>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-x-16 gap-y-8 items-start">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.2 }}
            >
              <p className="text-3xl text-white leading-tight">
                Your clients get the fabric. You get the credit.
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.3 }}
            >
              <p className="text-lg text-[#9BA0A2] mb-5 leading-relaxed">
                HyperCLI becomes your AI runtime: GPU
                scheduling. Autoscaling. Distributed execution.
                Model routing. Container isolation.
                Observability. Deployment blueprints.
              </p>
              <p className="text-lg text-[#9BA0A2] leading-relaxed">
                Delivered through your brand. Powered by our
                engine.
              </p>
            </motion.div>
          </div>
        </div>
      </section>

      {/* The Console */}
      <section className="pt-20 pb-20 px-4 sm:px-6 lg:px-8 bg-[#0B0D0E] border-t border-[#2A2D2F]/30">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <h2 className="text-5xl text-white mb-12 tracking-tight">
              The Console
            </h2>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-x-16 gap-y-8 items-start">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.2 }}
            >
              <p className="text-3xl text-white leading-tight">
                Multi-client control. Zero-touch operations.
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.3 }}
            >
              <p className="text-lg text-[#9BA0A2] mb-5 leading-relaxed">
                One dashboard for: Deployments. Clusters. Model
                endpoints. Usage. Cost. Policies. Logs.
              </p>
              <p className="text-lg text-[#9BA0A2] leading-relaxed">
                You manage outcomes. HyperCLI handles
                orchestration.
              </p>
            </motion.div>
          </div>
        </div>
      </section>

      {/* GTM Alignment */}
      <section className="pt-32 pb-32 px-4 sm:px-6 lg:px-8 bg-[#0B0D0E] border-t border-[#2A2D2F]/30">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <h2 className="text-5xl text-white mb-12 tracking-tight">
              GTM Alignment
            </h2>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.2 }}
          >
            <p className="text-3xl text-white mb-12 leading-tight max-w-2xl">
              We don't compete with you. We scale you.
            </p>

            <p className="text-lg text-[#9BA0A2] mb-5 leading-relaxed max-w-2xl">
              Partners receive: Lead sharing. Co-selling.
              Architecture support. Pilot assistance. Partner
              playbooks. Priority integration. Dedicated
              enablement.
            </p>

            <p className="text-lg text-[#9BA0A2] leading-relaxed max-w-2xl">
              You own the relationship. We power the
              infrastructure.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="pt-24 pb-32 px-4 sm:px-6 lg:px-8 bg-[#0B0D0E] border-t border-[#2A2D2F]/30">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <h2 className="text-6xl text-white mb-12 tracking-tight leading-tight max-w-3xl">
              Sell AI infrastructure without building it.
            </h2>

            <motion.button
              className="px-8 py-4 bg-[#38D39F] text-[#0B0D0E] rounded-lg hover:bg-[#45E4AE] transition-colors flex items-center gap-2"
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: 0.2 }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              Join the Partner Network
              <ArrowRight className="w-5 h-5" />
            </motion.button>
          </motion.div>
        </div>
      </section>
    </div>
  );
};
