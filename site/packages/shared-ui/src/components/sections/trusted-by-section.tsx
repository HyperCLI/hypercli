"use client";

import { motion } from 'framer-motion';
import { 
  SiGoogle, 
  SiNvidia, 
  SiAmazon, 
  SiMeta, 
  SiApple, 
  SiAudi, 
  SiSiemens, 
  SiAirbus 
} from 'react-icons/si';
import { FaMicrosoft, FaAws } from 'react-icons/fa';

export function TrustedBySection() {
  const companies = [
    { name: 'Google', Icon: SiGoogle },
    { name: 'Nvidia', Icon: SiNvidia },
    { name: 'Microsoft', Icon: FaMicrosoft },
    { name: 'Amazon', Icon: SiAmazon },
    { name: 'Meta', Icon: SiMeta },
    { name: 'Apple', Icon: SiApple },
    { name: 'AWS', Icon: FaAws },
    { name: 'Audi', Icon: SiAudi },
    { name: 'Siemens', Icon: SiSiemens },
    { name: 'Airbus', Icon: SiAirbus },
  ];

  return (
    <section className="relative py-24 sm:py-32 px-4 sm:px-6 lg:px-8 bg-background border-y border-border/5">
      {/* Subtle grain texture */}
      <div className="absolute inset-0 opacity-[0.02] pointer-events-none bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMDAiIGhlaWdodD0iMzAwIj48ZmlsdGVyIGlkPSJhIiB4PSIwIiB5PSIwIj48ZmVUdXJidWxlbmNlIGJhc2VGcmVxdWVuY3k9Ii43NSIgc3RpdGNoVGlsZXM9InN0aXRjaCIgdHlwZT0iZnJhY3RhbE5vaXNlIi8+PGZlQ29sb3JNYXRyaXggdHlwZT0ic2F0dXJhdGUiIHZhbHVlcz0iMCIvPjwvZmlsdGVyPjxwYXRoIGQ9Ik0wIDBoMzAwdjMwMEgweiIgZmlsdGVyPSJ1cmwoI2EpIiBvcGFjaXR5PSIuMDUiLz48L3N2Zz4=')]" />
      
      <div className="max-w-7xl mx-auto relative">
        {/* Title */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="text-center mb-20"
        >
          <h2 className="text-[40px] sm:text-[56px] lg:text-[72px] text-white leading-[0.9] tracking-[-0.05em] font-bold mb-6">
            Trusted by engineers at
          </h2>

        </motion.div>

        {/* Logo Grid */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-8 sm:gap-10 lg:gap-12 max-w-6xl mx-auto"
        >
          {companies.map((company, index) => (
            <motion.div
              key={company.name}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{ 
                duration: 0.5, 
                delay: 0.3 + (index * 0.05),
                ease: [0.22, 1, 0.36, 1]
              }}
              className="group relative flex flex-col items-center justify-center gap-4 p-6 rounded-2xl border border-border/5 bg-[#0F1112] hover:bg-[#141617] hover:border-border/10 transition-all duration-300"
            >
              <div className="relative flex items-center justify-center opacity-50 group-hover:opacity-100 transition-opacity duration-300">
                <company.Icon 
                  className="h-10 w-10 sm:h-12 sm:w-12 text-[#D4D6D7] group-hover:text-white transition-colors"
                  aria-label={`${company.name} logo`}
                />
              </div>
              <span className="text-sm sm:text-base text-[#9BA0A2] group-hover:text-white font-medium tracking-wide transition-colors">
                {company.name}
              </span>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}