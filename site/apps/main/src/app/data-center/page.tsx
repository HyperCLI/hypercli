"use client";

import { ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { Header, Footer } from "@hypercli/shared-ui";

export default function DataCenterPage() {
  return (
    <div className="min-h-screen bg-[#0B0D0E] overflow-x-hidden">
      <Header />
      {/* Hero Section */}
      <section className="relative pt-32 pb-24 px-4 sm:px-6 lg:px-8 bg-[#0B0D0E]">
        <motion.div 
          className="max-w-5xl mx-auto"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <h1 className="text-6xl sm:text-7xl lg:text-8xl text-white mb-8 leading-[1.1] tracking-tight max-w-4xl">
            Turn idle GPUs into revenue with one command
          </h1>

          <p className="text-2xl text-[#9BA0A2] leading-relaxed mb-10 max-w-2xl">
            HyperCLI is the easiest way for data centers to monetize unused GPU capacity. No SLAs, no commitments, no engineering required.
          </p>

          <div className="flex gap-4">
            <button className="px-8 py-4 bg-[#38D39F] text-[#0B0D0E] rounded-lg hover:bg-[#45E4AE] transition-colors flex items-center gap-2">
              Get the Data Center Deck
              <ArrowRight className="w-5 h-5" />
            </button>
            <button className="px-8 py-4 bg-[#161819]/40 text-white rounded-lg hover:bg-[#161819]/60 transition-colors border border-[#2A2D2F]/50">
              Talk to Infrastructure Partnerships
            </button>
          </div>
        </motion.div>
      </section>

      {/* The Data Center Opportunity */}
      <section className="pt-32 pb-32 px-4 sm:px-6 lg:px-8 bg-[#0B0D0E] border-t border-[#2A2D2F]/30">
        <div className="max-w-6xl mx-auto">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <h2 className="text-5xl text-white mb-12 tracking-tight">
              The Data Center Opportunity
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
                Your GPUs sit idle more than they earn. HyperCLI changes that.
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.3 }}
            >
              <p className="text-lg text-[#9BA0A2] mb-5 leading-relaxed">
                Data centers face: Idle GPU hours. Underutilized racks. Clients with unpredictable workloads. Low margins on traditional hosting. High overhead for GPU operations.
              </p>
              <p className="text-xl text-white leading-relaxed">
                HyperCLI solves all of this <span className="text-[#38D39F]">instantly</span>.
              </p>
            </motion.div>
          </div>
        </div>
      </section>

      {/* One Command Integration */}
      <section className="pt-20 pb-20 px-4 sm:px-6 lg:px-8 bg-[#0B0D0E] border-t border-[#2A2D2F]/30">
        <div className="max-w-6xl mx-auto">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <h2 className="text-5xl text-white mb-12 tracking-tight">
              One Command Integration
            </h2>

            <p className="text-3xl text-white mb-10 leading-tight">
              Run one Docker container. Start earning.
            </p>
          </motion.div>

          <motion.div 
            className="max-w-3xl mb-12"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            <div className="bg-[#161819]/40 border border-[#2A2D2F]/40 rounded-xl p-6 shadow-2xl">
              <div className="font-mono text-sm">
                <div className="text-[#D4D6D7]">$ docker run hyperdc/agent</div>
              </div>
            </div>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-6 mb-10">
            {[
              'Auto-discovers GPUs',
              'Validates hardware',
              'Connects securely',
              'Makes nodes job-ready',
              'Requires no inbound traffic',
              'Starts routing workloads immediately'
            ].map((feature, index) => (
              <motion.div 
                key={index}
                className="p-6 border border-[#2A2D2F]/50 rounded-lg"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
              >
                <p className="text-[#D4D6D7] leading-relaxed">
                  {feature}
                </p>
              </motion.div>
            ))}
          </div>

          <motion.p 
            className="text-xl text-[#D4D6D7] leading-relaxed"
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.6 }}
          >
            Online in under <span className="text-[#38D39F]">60 seconds</span>.
          </motion.p>
        </div>
      </section>

      {/* No SLAs. No Commitments */}
      <section className="pt-20 pb-20 px-4 sm:px-6 lg:px-8 bg-[#0B0D0E] border-t border-[#2A2D2F]/30">
        <div className="max-w-6xl mx-auto">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <h2 className="text-5xl text-white mb-12 tracking-tight">
              No SLAs. No Commitments. Zero Risk.
            </h2>

            <p className="text-3xl text-white mb-10 leading-tight">
              Connect whenever. Disconnect anytime.
            </p>

            <p className="text-lg text-[#9BA0A2] mb-8 leading-relaxed">
              Unlike GPU marketplaces, HyperCLI requires:
            </p>
          </motion.div>

          <div className="grid md:grid-cols-4 gap-6 mb-10">
            {[
              'No uptime guarantees',
              'No capacity commitments',
              'No reservations',
              'No listing overhead',
              'No support burden',
              'No penalties',
              'No lock-in'
            ].map((benefit, index) => (
              <motion.div 
                key={index}
                className="p-6 border border-[#2A2D2F]/50 rounded-lg"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.05 }}
              >
                <p className="text-xl text-white mb-3">
                  <span className="text-[#38D39F]">✓</span> {benefit}
                </p>
              </motion.div>
            ))}
          </div>

          <motion.p 
            className="text-xl text-[#D4D6D7] leading-relaxed"
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.35 }}
          >
            Revenue only when you choose to be available.
          </motion.p>
        </div>
      </section>

      {/* HyperCLI Handles Everything */}
      <section className="pt-20 pb-20 px-4 sm:px-6 lg:px-8 bg-[#0B0D0E] border-t border-[#2A2D2F]/30">
        <div className="max-w-6xl mx-auto">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <h2 className="text-5xl text-white mb-12 tracking-tight">
              HyperCLI Handles Everything
            </h2>

            <p className="text-3xl text-white mb-10 leading-tight">
              Your GPUs. Our orchestration. No operational burden.
            </p>

            <p className="text-lg text-[#9BA0A2] mb-8 leading-relaxed">
              We manage:
            </p>
          </motion.div>

          <div className="grid md:grid-cols-4 gap-6 mb-10">
            {[
              'Scheduling',
              'Routing',
              'Autoscaling',
              'GPU splitting',
              'Model placement',
              'Failover',
              'Billing + metering',
              'Isolation & security'
            ].map((task, index) => (
              <motion.div 
                key={index}
                className="p-6 border border-[#2A2D2F]/50 rounded-lg"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.05 }}
              >
                <p className="text-[#D4D6D7] leading-relaxed">
                  {task}
                </p>
              </motion.div>
            ))}
          </div>

          <div className="grid md:grid-cols-2 gap-x-16 gap-y-8 items-start">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.4 }}
            >
              <p className="text-xl text-white leading-tight">
                You provide hardware
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.5 }}
            >
              <p className="text-xl text-white leading-tight">
                We handle the workloads
              </p>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Any GPU, Any Configuration */}
      <section className="pt-20 pb-20 px-4 sm:px-6 lg:px-8 bg-[#0B0D0E] border-t border-[#2A2D2F]/30">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <h2 className="text-5xl text-white mb-12 tracking-tight">
              Any GPU, Any Configuration
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
                Monetize H100s, A100s, L40S, H200, B200 — or mixed fleets.
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.3 }}
            >
              <p className="text-lg text-[#9BA0A2] mb-5 leading-relaxed">
                Legacy + modern GPUs. Multi-tenant setups. Fractional GPU use. Heterogeneous clusters. Bare-metal or virtualized.
              </p>
              <p className="text-lg text-[#9BA0A2] leading-relaxed">
                If it runs Docker, it can earn.
              </p>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Enterprise Workloads */}
      <section className="pt-20 pb-20 px-4 sm:px-6 lg:px-8 bg-[#0B0D0E] border-t border-[#2A2D2F]/30">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <h2 className="text-5xl text-white mb-12 tracking-tight">
              Enterprise Workloads Delivered to You
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
                HyperCLI brings the demand. You earn the revenue.
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.3 }}
            >
              <p className="text-lg text-[#9BA0A2] mb-5 leading-relaxed">
                LLM inference. Media generation. Agents / toolcalling. Fine-tuning. Training. Batch pipelines.
              </p>
              <p className="text-lg text-[#9BA0A2] leading-relaxed">
                No need for a sales team — we supply the jobs.
              </p>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Revenue Model */}
      <section className="pt-20 pb-20 px-4 sm:px-6 lg:px-8 bg-[#0B0D0E] border-t border-[#2A2D2F]/30">
        <div className="max-w-6xl mx-auto">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <h2 className="text-5xl text-white mb-12 tracking-tight">
              Revenue Model
            </h2>

            <p className="text-3xl text-white mb-10 leading-tight">
              Recurring payouts with full transparency.
            </p>

            <p className="text-lg text-[#9BA0A2] mb-8 leading-relaxed">
              You earn:
            </p>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-6 mb-10">
            {[
              'A share of compute revenue',
              'Monthly payouts',
              'Per-job metering',
              'Dashboard visibility',
              'No overhead, no humans required'
            ].map((feature, index) => (
              <motion.div 
                key={index}
                className="p-6 border border-[#2A2D2F]/50 rounded-lg"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
              >
                <p className="text-[#D4D6D7] leading-relaxed">
                  {feature}
                </p>
              </motion.div>
            ))}
          </div>

          <motion.p 
            className="text-2xl text-white leading-relaxed"
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.5 }}
          >
            100 H100s can generate <span className="text-[#38D39F]">~$700k/year</span> in DC share
          </motion.p>
        </div>
      </section>

      {/* Perfect for All Data Center Types */}
      <section className="pt-20 pb-20 px-4 sm:px-6 lg:px-8 bg-[#0B0D0E] border-t border-[#2A2D2F]/30">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <h2 className="text-5xl text-white mb-12 tracking-tight">
              Perfect for All Data Center Types
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
                If you have GPUs, you can earn.
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.3 }}
            >
              <p className="text-lg text-[#9BA0A2] leading-relaxed">
                Regional colos. GPU hosting providers. HPC centers. Sovereign cloud. Private cloud. Research labs.
              </p>
            </motion.div>
          </div>
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
              Monetize your GPUs with one command
            </h2>
            
            <div className="flex gap-4">
              <motion.button 
                className="px-8 py-4 bg-[#38D39F] text-[#0B0D0E] rounded-lg hover:bg-[#45E4AE] transition-colors flex items-center gap-2"
                initial={{ opacity: 0, scale: 0.95 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: 0.2 }}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                Get the Data Center Deck
                <ArrowRight className="w-5 h-5" />
              </motion.button>
              <motion.button 
                className="px-8 py-4 bg-[#161819]/40 text-white rounded-lg hover:bg-[#161819]/60 transition-colors border border-[#2A2D2F]/50"
                initial={{ opacity: 0, scale: 0.95 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: 0.3 }}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                Schedule a Technical Call
              </motion.button>
            </div>
          </motion.div>
        </div>
      </section>

      <Footer />
    </div>
  );
}