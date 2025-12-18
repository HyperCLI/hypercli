"use client";

import { useState } from 'react';
import { Server, Handshake, Building2, Shield, ArrowRight } from 'lucide-react';
import ContactModal from '../ContactModal';

export function EnterpriseTeaserSection() {
  const [isContactModalOpen, setIsContactModalOpen] = useState(false);

  const teasers = [
    {
      icon: Server,
      title: 'Bring Your Own GPU',
      subtitle: 'Have GPUs? Connect them with one command.',
      description: 'Use your own on-prem servers, lab machines, or GPU clusters. HyperCLI handles scheduling, scaling, isolation, and orchestration.',
      code: 'hypercli attach-gpu',
      note: 'Perfect for internal IT teams and GPU-rich organizations.',
      cta: 'Learn more',
      href: '#',
      onClick: (e: React.MouseEvent) => {
        e.preventDefault();
        setIsContactModalOpen(true);
      }
    },
    {
      icon: Handshake,
      title: 'Partners',
      subtitle: 'Resell HyperCLI. Earn recurring AI revenue.',
      description: 'For consultancies, VARs, and MSPs:',
      features: ['Partner margins', 'Services expansion', 'Co-selling support', 'Multi-client management'],
      cta: 'Partner with HyperCLI',
      href: '/partner'
    },
    {
      icon: Building2,
      title: 'Data Centers',
      subtitle: 'Turn idle GPUs into revenue with one command.',
      description: 'No commitments. No SLAs. No marketplace overhead. Just run the HyperCLI agent and start earning on enterprise workloads.',
      cta: 'For Data Centers',
      href: '/data-center'
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
      href: '/enterprise'
    }
  ];

  return (
    <section className="relative min-h-screen py-24 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-[#0D0F10] via-[#0B0D0E] to-[#080909] overflow-hidden flex items-center">
      {/* Atmospheric effects */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#0B0D0E]/80 to-[#080909] pointer-events-none" />
      <div className="absolute bottom-0 left-1/4 w-[600px] h-[400px] bg-[#38D39F]/5 blur-[140px] rounded-full" />
      <div className="absolute top-1/4 right-0 w-[400px] h-[400px] bg-[#38D39F]/3 blur-[120px] rounded-full" />

      <div className="max-w-7xl mx-auto relative w-full">
        {/* 2x2 Card Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {teasers.map((teaser, index) => (
            <a
              key={index}
              href={teaser.href}
              onClick={teaser.onClick}
              className="group relative flex flex-col bg-[#161819]/80 backdrop-blur-sm border border-[#2A2D2F] rounded-2xl p-8 hover:border-[#38D39F]/40 hover:bg-[#1D1F21]/80 transition-all duration-300 h-full"
            >
              {/* Icon & Title Row */}
              <div className="flex items-center gap-4 mb-6">
                <div className="w-12 h-12 rounded-xl bg-[#38D39F]/10 flex items-center justify-center flex-shrink-0 group-hover:bg-[#38D39F]/20 transition-colors border border-[#38D39F]/20">
                  <teaser.icon className="w-6 h-6 text-[#38D39F]" />
                </div>
                <div>
                  <h3 className="text-2xl font-semibold text-white group-hover:text-[#38D39F] transition-colors">{teaser.title}</h3>
                </div>
              </div>

              {/* Subtitle */}
              <p className="text-lg text-[#38D39F]/90 mb-4 font-medium">{teaser.subtitle}</p>

              {/* Description */}
              {teaser.description && (
                <p className="text-[#9BA0A2] mb-6 leading-relaxed flex-grow">
                  {teaser.description}
                </p>
              )}

              {/* Code Block */}
              {teaser.code && (
                <div className="bg-[#0B0D0E] border border-[#2A2D2F] rounded-xl p-4 mb-4">
                  <code className="text-sm text-[#38D39F] font-mono">$ {teaser.code}</code>
                </div>
              )}

              {/* Features List */}
              {teaser.features && (
                <ul className="grid grid-cols-2 gap-2 mb-6 flex-grow">
                  {teaser.features.map((feature, idx) => (
                    <li key={idx} className="flex items-center gap-2 text-sm text-[#D4D6D7]">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#38D39F] flex-shrink-0" />
                      {feature}
                    </li>
                  ))}
                </ul>
              )}

              {/* Note */}
              {teaser.note && (
                <p className="text-sm text-[#6E7375] mb-4 italic">
                  {teaser.note}
                </p>
              )}

              {/* CTA */}
              <div className="flex items-center gap-2 text-[#38D39F] group-hover:text-[#45E4AE] transition-colors mt-auto pt-4 border-t border-[#2A2D2F]/50">
                <span className="font-medium">{teaser.cta}</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </div>
            </a>
          ))}
        </div>
      </div>

      <ContactModal isOpen={isContactModalOpen} onClose={() => setIsContactModalOpen(false)} source="bring-your-own-gpu" />
    </section>
  );
}
