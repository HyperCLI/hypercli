"use client";

import { Server, Handshake, Building2, Shield, ArrowRight } from 'lucide-react';

export function EnterpriseTeaserSection() {
  const teasers = [
    {
      icon: Server,
      title: 'Bring Your Own GPU',
      subtitle: 'Have GPUs? Connect them with one command.',
      description: 'Use your own on-prem servers, lab machines, or GPU clusters. HyperCLI handles scheduling, scaling, isolation, and orchestration.',
      code: 'hypercli attach-gpu',
      note: 'Perfect for internal IT teams and GPU-rich organizations.',
      cta: 'Learn more',
      link: '#'
    },
    {
      icon: Handshake,
      title: 'Partners',
      subtitle: 'Resell HyperCLI. Earn recurring AI revenue.',
      description: 'For consultancies, VARs, and MSPs:',
      features: ['Partner margins', 'Services expansion', 'Co-selling support', 'Multi-client management'],
      cta: 'Partner with HyperCLI',
      link: '#',
      onClick: () => window.location.href = '/partners'
    },
    {
      icon: Building2,
      title: 'Data Centers',
      subtitle: 'Turn idle GPUs into revenue with one command.',
      description: 'No commitments. No SLAs. No marketplace overhead. Just run the HyperCLI agent and start earning on enterprise workloads.',
      cta: 'For Data Centers',
      link: '#',
      onClick: () => window.location.href = '/datacenter'
    },
    {
      icon: Shield,
      title: 'Enterprise',
      subtitle: 'Enterprise-ready from day one.',
      features: [
        'SSO/SAML',
        'VPC peering',
        'Private clusters',
        'Audit logging',
        'Compliance (SOC2/ISO)',
        'On-prem / air-gapped deployments'
      ],
      cta: 'Explore Enterprise Features',
      link: '#',
      onClick: () => window.location.href = '/enterprise'
    }
  ];

  return (
    <section className="relative py-40 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-[#0D0F10] via-[#0B0D0E] to-[#080909] overflow-hidden">
      {/* Atmospheric dark-to-darker transitions */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#0B0D0E]/80 to-[#080909] pointer-events-none" />
      <div className="absolute bottom-0 left-1/4 w-[600px] h-[400px] bg-[#38D39F]/5 blur-[140px] rounded-full" />
      
      <div className="max-w-7xl mx-auto relative">
        {/* Grid of teasers - lighter structure */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-16">
          {teasers.map((teaser, index) => (
            <div
              key={index}
              className="group relative pb-12 border-b border-[#1F2122]/50 last:border-0 hover:border-[#38D39F]/20 transition-all duration-500"
            >
              <div className="flex items-start gap-5 mb-8">
                <div className="w-14 h-14 rounded-xl bg-[#38D39F]/10 flex items-center justify-center flex-shrink-0 group-hover:bg-[#38D39F]/20 transition-colors border border-[#38D39F]/10">
                  <teaser.icon className="w-7 h-7 text-[#38D39F]" />
                </div>
                <div>
                  <h3 className="text-3xl text-white mb-2 group-hover:text-[#38D39F] transition-colors">{teaser.title}</h3>
                  <p className="text-base text-[#38D39F]/80">{teaser.subtitle}</p>
                </div>
              </div>

              <p className="text-lg text-[#9BA0A2] mb-6 leading-relaxed">
                {teaser.description}
              </p>

              {teaser.code && (
                <div className="bg-[#111314]/60 backdrop-blur-sm border border-[#2A2D2F]/50 rounded-xl p-5 mb-6">
                  <code className="text-base text-[#38D39F] font-mono">{teaser.code}</code>
                </div>
              )}

              {teaser.features && (
                <ul className="space-y-3 mb-6">
                  {teaser.features.map((feature, idx) => (
                    <li key={idx} className="flex items-center gap-3 text-base text-[#D4D6D7]">
                      <span className="w-2 h-2 rounded-full bg-[#38D39F]" />
                      {feature}
                    </li>
                  ))}
                </ul>
              )}

              {teaser.note && (
                <p className="text-base text-[#9BA0A2] mb-6 italic">
                  {teaser.note}
                </p>
              )}

              <button 
                onClick={teaser.onClick}
                className="text-lg text-[#38D39F] hover:text-[#45E4AE] transition-colors inline-flex items-center gap-3 group-hover:translate-x-1 transition-transform duration-300"
              >
                {teaser.cta}
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}