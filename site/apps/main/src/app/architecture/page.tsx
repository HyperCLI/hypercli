"use client";

import { ArrowRight } from "lucide-react";
import { motion } from 'framer-motion';
import { Header, Footer } from '@hypercli/shared-ui';

export default function Page() {
  return (
    <div className="bg-background">
      <Header />
      {/* Hero Section */}
      <section className="relative pt-32 pb-24 px-4 sm:px-6 lg:px-8 bg-background">
        <motion.div
          className="max-w-5xl mx-auto"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <h1 className="text-6xl sm:text-7xl lg:text-8xl text-white mb-8 leading-[1.1] tracking-tight max-w-4xl">
            A Distributed Compute Fabric for Modern AI
          </h1>

          <p className="text-2xl text-muted-foreground leading-relaxed mb-6 max-w-2xl">
            An orchestration engine built for scale, precision, and real workloads.
          </p>

          <p className="text-xl text-muted-foreground leading-relaxed max-w-2xl">
            Inference. Training. Media generation. Agents. Pipelines. Unified under one runtime.
          </p>
        </motion.div>
      </section>

      {/* The Runtime */}
      <section className="pt-32 pb-32 px-4 sm:px-6 lg:px-8 bg-background border-t border-border-medium/30">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <h2 className="text-5xl text-white mb-12 tracking-tight">The Runtime</h2>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-x-16 gap-y-8 items-start">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.2 }}
            >
              <p className="text-3xl text-white leading-tight">One Interface. Infinite Execution Paths.</p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.3 }}
            >
              <p className="text-lg text-muted-foreground mb-5 leading-relaxed">Hyper abstracts the complexity of running AI workloads:</p>

              <p className="text-lg text-muted-foreground mb-10 leading-relaxed">
                Containerized execution. Model runtime acceleration. Distributed scheduling. GPU multiplexing. Memory-efficient loading. Intelligent caching.
              </p>

              <p className="text-xl text-white mb-3 leading-relaxed">Your code becomes a deployable artifact.</p>
              <p className="text-xl text-secondary-foreground leading-relaxed">Hyper handles everything else.</p>
            </motion.div>
          </div>
        </div>
      </section>

      {/* The Scheduler */}
      <section className="pt-20 pb-20 px-4 sm:px-6 lg:px-8 bg-background border-t border-border-medium/30">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <h2 className="text-5xl text-white mb-12 tracking-tight">The Scheduler</h2>

            <p className="text-3xl text-white mb-10 leading-tight">A Low-Latency, High-Throughput Orchestrator.</p>

            <p className="text-lg text-muted-foreground mb-8 leading-relaxed">The scheduler continuously evaluates:</p>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-6 mb-10">
            {[
              'GPU availability',
              'Model placement',
              'Parallelizable segments',
              'Token throughput',
              'Latency targets',
              'Failure domains'
            ].map((item, index) => (
              <motion.div
                key={index}
                className="p-6 border border-border-medium/50 rounded-lg"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
              >
                <p className="text-secondary-foreground leading-relaxed">{item}</p>
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
            Workloads are dynamically routed to the optimal hardware in milliseconds.
          </motion.p>
        </div>
      </section>

      {/* GPU Fabric */}
      <section className="pt-20 pb-20 px-4 sm:px-6 lg:px-8 bg-background border-t border-border-medium/30">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <h2 className="text-5xl text-white mb-12 tracking-tight">GPU Fabric</h2>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-x-16 gap-y-8 items-start">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.2 }}
            >
              <p className="text-3xl text-white leading-tight mb-6">A virtualized grid of GPUs.</p>
              <p className="text-2xl text-muted-foreground leading-tight">Elastic. Heterogeneous. Everywhere.</p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.3 }}
            >
              <p className="text-lg text-muted-foreground mb-5 leading-relaxed">Hyper supports:</p>

              <p className="text-lg text-muted-foreground mb-10 leading-relaxed">
                H100 / A100 / H200 / B200. L40S / L4 / older architectures. Mixed fleets. Shared nodes. Fractional GPUs. Multi-DC routing.
              </p>

              <p className="text-xl text-white mb-3 leading-relaxed">The physical limits disappear.</p>
              <p className="text-xl text-secondary-foreground leading-relaxed">The fabric handles the rest.</p>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Model Optimization */}
      <section className="pt-20 pb-20 px-4 sm:px-6 lg:px-8 bg-background border-t border-border-medium/30">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <h2 className="text-5xl text-white mb-12 tracking-tight">Model Optimization</h2>

            <p className="text-3xl text-white mb-10 leading-tight">Performance through specialization.</p>

            <p className="text-lg text-muted-foreground mb-8 leading-relaxed">Hyper integrates the best model-acceleration stacks:</p>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-6 mb-10">
            {[
              'vLLM',
              'SGLang',
              'TensorRT-LLM',
              'GGUF / AWQ / GPTQ',
              'Speculative decoding',
              'Quantization-aware workloads'
            ].map((item, index) => (
              <motion.div
                key={index}
                className="p-6 border border-border-medium/50 rounded-lg"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
              >
                <p className="text-secondary-foreground leading-relaxed">{item}</p>
              </motion.div>
            ))}
          </div>

          <motion.p
            className="text-xl text-white mb-3 leading-relaxed"
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.6 }}
          >
            Everything runs at peak efficiency.
          </motion.p>
          <motion.p
            className="text-xl text-secondary-foreground leading-relaxed"
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.7 }}
          >
            Without manual tuning.
          </motion.p>
        </div>
      </section>

      {/* Autoscaling */}
      <section className="pt-20 pb-20 px-4 sm:px-6 lg:px-8 bg-background border-t border-border-medium/30">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <h2 className="text-5xl text-white mb-12 tracking-tight">Autoscaling</h2>

            <p className="text-3xl text-white mb-10 leading-tight">Predictive scaling for unpredictable workloads.</p>

            <p className="text-lg text-muted-foreground mb-8 leading-relaxed">Hyper anticipates demand:</p>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-6 mb-10">
            {[
              'Pre-warms models',
              'Manages cold starts',
              'Predicts concurrency',
              'Allocates fractional GPUs',
              'Prunes idle nodes',
              'Stabilizes latency'
            ].map((item, index) => (
              <motion.div
                key={index}
                className="p-6 border border-border-medium/50 rounded-lg"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
              >
                <p className="text-secondary-foreground leading-relaxed">{item}</p>
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
            Capacity grows and contracts with workload pressure.
          </motion.p>
        </div>
      </section>

      {/* Multi-Environment Execution */}
      <section className="pt-20 pb-20 px-4 sm:px-6 lg:px-8 bg-background border-t border-border-medium/30">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <h2 className="text-5xl text-white mb-12 tracking-tight">Multi-Environment Execution</h2>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-x-16 gap-y-8 items-start">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.2 }}
            >
              <p className="text-3xl text-white leading-tight mb-6">Cloud. On-prem. Air-gapped.</p>
              <p className="text-2xl text-muted-foreground leading-tight">One runtime across all environments.</p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.3 }}
            >
              <p className="text-lg text-muted-foreground mb-5 leading-relaxed">The architecture supports:</p>

              <p className="text-lg text-muted-foreground mb-10 leading-relaxed">
                Private GPU clusters. Sovereign deployments. Regulated workloads. Multi-region failover. Zero-trust boundaries.
              </p>

              <p className="text-xl text-secondary-foreground leading-relaxed">Every environment behaves like part of the same system.</p>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Observability */}
      <section className="pt-20 pb-20 px-4 sm:px-6 lg:px-8 bg-background border-t border-border-medium/30">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <h2 className="text-5xl text-white mb-12 tracking-tight">Observability</h2>

            <p className="text-3xl text-white mb-10 leading-tight">Visibility into every token and thread.</p>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-6 mb-10">
            {[
              'Job timelines',
              'Resource allocation',
              'Latency breakdowns',
              'Model logs',
              'GPU metrics',
              'Cost insights'
            ].map((item, index) => (
              <motion.div
                key={index}
                className="p-6 border border-border-medium/50 rounded-lg"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
              >
                <p className="text-secondary-foreground leading-relaxed">{item}</p>
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
            The fabric is opaque to manage, but transparent to observe.
          </motion.p>
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
            <h2 className="text-6xl text-white mb-12 tracking-tight leading-tight max-w-3xl">The Fabric Awaits.</h2>
            
            <motion.button
              className="px-8 py-4 bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover transition-colors flex items-center gap-2"
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: 0.2 }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              See the Architecture in Action
              <ArrowRight className="w-5 h-5" />
            </motion.button>
          </motion.div>
        </div>
      </section>
      <Footer />
    </div>
  );
}
