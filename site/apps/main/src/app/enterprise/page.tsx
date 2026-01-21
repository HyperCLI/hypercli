"use client";

import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { Header, Footer, ContactModal } from '@hypercli/shared-ui';

export default function EnterprisePage() {
  const [isContactModalOpen, setIsContactModalOpen] = useState(false);

  return (
    <div className="bg-background min-h-screen">
      <Header />
      {/* Hero Section */}
      <main>
        <section className="relative pt-32 pb-24 px-4 sm:px-6 lg:px-8 bg-background">
          <motion.div 
            className="max-w-5xl mx-auto"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <h1 className="text-6xl sm:text-7xl lg:text-8xl text-white mb-8 leading-[1.1] tracking-tight max-w-4xl">
              Enterprise AI, without the infrastructure burden
            </h1>

            <p className="text-2xl text-muted-foreground leading-relaxed mb-10 max-w-2xl">
              HyperCLI gives your teams a secure, scalable platform for LLMs, agents, RAG, media generation, and training — across cloud, on-prem, or air-gapped environments.
            </p>

            <div className="flex gap-4">
              <button 
                onClick={() => setIsContactModalOpen(true)}
                className="px-8 py-4 bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover transition-colors flex items-center gap-2 cursor-pointer"
              >
                Talk to Sales
                <ArrowRight className="w-5 h-5" />
              </button>
              <button 
                onClick={() => setIsContactModalOpen(true)}
                className="px-8 py-4 bg-surface-low/40 text-white rounded-lg hover:bg-surface-low/60 transition-colors border border-border-medium/50 cursor-pointer"
              >
                Request a Technical Demo
              </button>
            </div>
          </motion.div>
        </section>

        {/* Why Enterprises Choose HyperCLI */}
        <section className="pt-32 pb-32 px-4 sm:px-6 lg:px-8 bg-background border-t border-border-medium/30">
          <div className="max-w-5xl mx-auto">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5 }}
            >
              <h2 className="text-5xl text-white mb-12 tracking-tight">Why Enterprises Choose HyperCLI</h2>
            </motion.div>

            <div className="grid md:grid-cols-2 gap-x-16 gap-y-8 items-start">
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: 0.2 }}
              >
                <p className="text-3xl text-white leading-tight">The fastest way to deploy AI at scale.</p>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, x: 20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: 0.3 }}
              >
                <p className="text-lg text-muted-foreground mb-5 leading-relaxed">
                  Deploy models in seconds. 90% lower compute cost. Works across any cloud or on-prem. No GPU/K8s expertise required. Global orchestration layer built-in. Security, compliance, governance.
                </p>
                <p className="text-lg text-muted-foreground leading-relaxed">HyperCLI accelerates AI adoption across the entire organization.</p>
              </motion.div>
            </div>
          </div>
        </section>

        {/* AI That Runs Anywhere */}
        <section className="pt-20 pb-20 px-4 sm:px-6 lg:px-8 bg-background border-t border-border-medium/30">
          <div className="max-w-5xl mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5 }}
            >
              <h2 className="text-5xl text-white mb-12 tracking-tight">AI That Runs Anywhere</h2>
            </motion.div>

            <div className="grid md:grid-cols-2 gap-x-16 gap-y-8 items-start">
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: 0.2 }}
              >
                <p className="text-3xl text-white leading-tight">Cloud, on-prem, air-gapped, hybrid — we support it all.</p>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, x: 20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: 0.3 }}
              >
                <p className="text-lg text-muted-foreground mb-5 leading-relaxed">
                  AWS, GCP, Azure. OCI, sovereign clouds. Private GPU clusters. Data center & colo. Completely air-gapped networks.
                </p>
                <p className="text-lg text-muted-foreground leading-relaxed">You choose the environment. HyperCLI orchestrates the workloads.</p>
              </motion.div>
            </div>
          </div>
        </section>

        {/* Enterprise-Grade Security */}
        <section className="pt-20 pb-20 px-4 sm:px-6 lg:px-8 bg-background border-t border-border-medium/30">
          <div className="max-w-5xl mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5 }}
            >
              <h2 className="text-5xl text-white mb-12 tracking-tight">Enterprise-Grade Security</h2>

              <p className="text-3xl text-white mb-10 leading-tight">Zero-trust architecture. Full isolation. Compliance-ready.</p>

              <p className="text-lg text-muted-foreground mb-8 leading-relaxed">Security features:</p>
            </motion.div>

            <div className="grid md:grid-cols-4 gap-6 mb-10">
              {[
                'SSO / SAML / SCIM',
                'VPC peering (AWS, GCP, Azure)',
                'Private clusters',
                'Zero inbound traffic required',
                'Encrypted data transport',
                'Audit logs',
                'SOC2 / ISO alignment',
                'On-prem + offline mode'
              ].map((feature, index) => (
                <motion.div 
                  key={index}
                  className="p-6 border border-border-medium/50 rounded-lg"
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: index * 0.05 }}
                >
                  <p className="text-secondary-foreground leading-relaxed">{feature}</p>
                </motion.div>
              ))}
            </div>

            <motion.p 
              className="text-xl text-secondary-foreground leading-relaxed"
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.4 }}
            >
              Trusted by enterprise clients requiring strict security boundaries.
            </motion.p>
          </div>
        </section>

        {/* AI Use Cases */}
        <section className="pt-20 pb-20 px-4 sm:px-6 lg:px-8 bg-background border-t border-border-medium/30">
          <div className="max-w-5xl mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5 }}
            >
              <h2 className="text-5xl text-white mb-12 tracking-tight">AI Use Cases the Enterprise Can Deploy</h2>
            </motion.div>

            <div className="grid md:grid-cols-2 gap-x-16 gap-y-8 items-start">
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: 0.2 }}
              >
                <p className="text-3xl text-white leading-tight">HyperCLI supports every modern enterprise AI workload.</p>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, x: 20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: 0.3 }}
              >
                <p className="text-lg text-muted-foreground leading-relaxed">
                  LLMs: Llama, Mistral, GPT-style models. RAG: Enterprise search, knowledge intelligence. Media Gen: Images, video, embeddings. Agents: Tools, retrieval, function calling. Training/Fine-Tuning: LoRA, QLoRA. Pipelines/Flows: Batch, streaming.
                </p>
              </motion.div>
            </div>
          </div>
        </section>

        {/* Observability & Governance */}
        <section className="pt-20 pb-20 px-4 sm:px-6 lg:px-8 bg-background border-t border-border-medium/30">
          <div className="max-w-5xl mx-auto">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5 }}
            >
              <h2 className="text-5xl text-white mb-12 tracking-tight">Observability & Governance</h2>

              <p className="text-3xl text-white mb-10 leading-tight">All the guardrails you need.</p>

              <p className="text-lg text-muted-foreground mb-8 leading-relaxed">Governance features:</p>
            </motion.div>

            <div className="grid md:grid-cols-4 gap-6 mb-10">
              {[
                'Cost dashboards',
                'GPU usage insights',
                'Model registry',
                'Audit trails',
                'Secrets management',
                'Role-based access control',
                'Data locality controls',
                'Policy enforcement'
              ].map((feature, index) => (
                <motion.div 
                  key={index}
                  className="p-6 border border-border-medium/50 rounded-lg"
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: index * 0.05 }}
                >
                  <p className="text-secondary-foreground leading-relaxed">{feature}</p>
                </motion.div>
              ))}
            </div>

            <motion.p 
              className="text-xl text-secondary-foreground leading-relaxed"
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.4 }}
            >
              Governance built for Fortune 500 standards.
            </motion.p>
          </div>
        </section>

        {/* Why HyperCLI Beats Cloud Providers */}
        <section className="pt-20 pb-20 px-4 sm:px-6 lg:px-8 bg-background border-t border-border-medium/30">
          <div className="max-w-5xl mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5 }}
            >
              <h2 className="text-5xl text-white mb-12 tracking-tight">Why HyperCLI Beats Cloud Providers</h2>

              <p className="text-3xl text-white mb-10 leading-tight">Faster. Cheaper. More flexible. No lock-in.</p>

              <p className="text-lg text-muted-foreground mb-8 leading-relaxed">Compared to hyperscalers:</p>
            </motion.div>

            <div className="grid md:grid-cols-3 gap-6 mb-10">
              {[
                'Deploy 10× faster',
                'Up to 90% cheaper',
                'No heavy K8s ops',
                'No GPU commitment required',
                'No vendor lock-in',
                'Runs on your infrastructure'
              ].map((benefit, index) => (
                <motion.div 
                  key={index}
                  className="p-6 border border-border-medium/50 rounded-lg"
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: index * 0.1 }}
                >
                  <p className="text-xl text-white mb-3"><span className="text-primary">✓</span> {benefit}</p>
                </motion.div>
              ))}
            </div>

            <motion.p 
              className="text-xl text-secondary-foreground leading-relaxed"
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.6 }}
            >
              HyperCLI simplifies everything between "We want AI" and "It's in production."
            </motion.p>
          </div>
        </section>

        {/* Scale Across the Organization */}
        <section className="pt-20 pb-20 px-4 sm:px-6 lg:px-8 bg-background border-t border-border-medium/30">
          <div className="max-w-5xl mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5 }}
            >
              <h2 className="text-5xl text-white mb-12 tracking-tight">Scale Across the Organization</h2>
            </motion.div>

            <div className="grid md:grid-cols-2 gap-x-16 gap-y-8 items-start">
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: 0.2 }}
              >
                <p className="text-3xl text-white leading-tight mb-8">From a single developer → company-wide platform.</p>

                <p className="text-xl text-white mb-5">Start with:</p>
                <p className="text-lg text-muted-foreground leading-relaxed">Innovation teams. Data science. Internal tools. R&D. Prototyping.</p>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, x: 20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: 0.3 }}
              >
                <p className="text-xl text-white mb-5">Scale to:</p>
                <p className="text-lg text-muted-foreground mb-10 leading-relaxed">Customer-facing AI. Production workloads. Global rollouts. Multi-region deployments. Regulated workloads.</p>

                <p className="text-xl text-secondary-foreground leading-relaxed">HyperCLI becomes your AI infrastructure fabric.</p>
              </motion.div>
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="pt-24 pb-32 px-4 sm:px-6 lg:px-8 bg-background border-t border-border-medium/30">
          <div className="max-w-5xl mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5 }}
            >
              <h2 className="text-6xl text-white mb-12 tracking-tight leading-tight max-w-3xl">Build your enterprise AI platform on HyperCLI</h2>
              
              <div className="flex gap-4">
                <motion.button 
                  onClick={() => setIsContactModalOpen(true)}
                  className="px-8 py-4 bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover transition-colors flex items-center gap-2 cursor-pointer"
                  initial={{ opacity: 0, scale: 0.95 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, delay: 0.2 }}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  Talk to Sales
                  <ArrowRight className="w-5 h-5" />
                </motion.button>
                <motion.button 
                  onClick={() => setIsContactModalOpen(true)}
                  className="px-8 py-4 bg-surface-low/40 text-white rounded-lg hover:bg-surface-low/60 transition-colors border border-border-medium/50 cursor-pointer"
                  initial={{ opacity: 0, scale: 0.95 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, delay: 0.3 }}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  See Architecture Diagrams
                </motion.button>
              </div>
            </motion.div>
          </div>
        </section>

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
