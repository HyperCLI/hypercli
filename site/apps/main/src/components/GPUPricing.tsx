"use client";

import { useEffect, useState } from "react";
import { ContactModal, GPU_INFO, getGPUDisplayName, getRegionName, getRegionFlag } from "@hypercli/shared-ui";

interface InstanceConfig {
  gpu_count: number;
  cpu_cores: number;
  memory_gb: number;
  storage_gb: number;
  regions: string[];
}

interface InstanceType {
  name: string;
  description: string;
  configs: InstanceConfig[];
}

interface RegionPricing {
  "on-demand"?: number;
  interruptable?: number;
}

interface InstancePricing {
  [region: string]: RegionPricing;
}

interface Instance {
  id: string;
  gpu_type: string;
  gpu_count: number;
  cpu_cores: number;
  memory_gb: number;
  storage_gb: number;
  regions: string[];
  pricing: InstancePricing;
  minOnDemand?: number;
  minInterruptible?: number;
}

export default function GPUPricing() {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedInstance, setSelectedInstance] = useState<Instance | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const instancesApiUrl = process.env.NEXT_PUBLIC_INSTANCES_API_URL;
        if (!instancesApiUrl) {
          throw new Error("NEXT_PUBLIC_INSTANCES_API_URL not configured");
        }

        const [typesRes, pricingRes] = await Promise.all([
          fetch(`${instancesApiUrl}/types`),
          fetch(`${instancesApiUrl}/pricing`),
        ]);

        const typesData: Record<string, InstanceType> = await typesRes.json();
        const pricingData: Record<string, InstancePricing> = await pricingRes.json();

        const instanceArray: Instance[] = [];

        Object.entries(typesData).forEach(([gpuKey, gpuData]) => {
          gpuData.configs.forEach((config) => {
            if (!config.regions || config.regions.length === 0) return;

            const id = `${gpuKey}_x${config.gpu_count}`;
            const pricing = pricingData[id] || {};

            let minOnDemand: number | undefined;
            let minInterruptible: number | undefined;

            Object.values(pricing).forEach((regionPricing) => {
              if (regionPricing["on-demand"]) {
                minOnDemand = minOnDemand ? Math.min(minOnDemand, regionPricing["on-demand"]) : regionPricing["on-demand"];
              }
              if (regionPricing.interruptable) {
                minInterruptible = minInterruptible ? Math.min(minInterruptible, regionPricing.interruptable) : regionPricing.interruptable;
              }
            });

            instanceArray.push({
              id,
              gpu_type: gpuKey,
              gpu_count: config.gpu_count,
              cpu_cores: config.cpu_cores,
              memory_gb: config.memory_gb,
              storage_gb: config.storage_gb,
              regions: config.regions,
              pricing,
              minOnDemand,
              minInterruptible,
            });
          });
        });

        const gpuOrder = ["b300", "b200", "h200", "h100", "a100_80", "a100_40", "l40s", "rtxpro6000", "rtx6000ada", "a6000", "l4"];
        instanceArray.sort((a, b) => {
          const aIdx = gpuOrder.indexOf(a.gpu_type);
          const bIdx = gpuOrder.indexOf(b.gpu_type);
          if (aIdx !== bIdx) return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
          return a.gpu_count - b.gpu_count;
        });

        setInstances(instanceArray);
        setSelectedInstance(instanceArray[0] || null);
        setLoading(false);
      } catch (err) {
        setError("Failed to load GPU instances");
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const gpuTypes = [...new Set(instances.map((i) => i.gpu_type))];

  const filteredInstances = instances.filter((i) => {
    if (filter === "all") return true;
    return i.gpu_type === filter;
  });

  if (loading) {
    return (
      <div className="py-20 text-center">
        <div className="inline-block h-12 w-12 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent"></div>
        <p className="mt-4 text-muted-foreground">Loading instances...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-20 text-center">
        <p className="text-red-500">{error}</p>
      </div>
    );
  }

  return (
    <>
      <section className="py-4 sm:py-6 bg-background">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
          {/* Filter Tabs */}
          <div className="flex flex-wrap justify-center gap-3 mb-8">
            <button
              onClick={() => setFilter("all")}
              className={`px-6 py-2 rounded-full font-semibold transition-all cursor-pointer ${
                filter === "all"
                  ? "bg-primary text-primary-foreground shadow-[0_0_20px_rgba(56,211,159,0.3)]"
                  : "bg-surface-low text-muted-foreground hover:bg-surface-high hover:text-white border border-border-medium"
              }`}
            >
              All GPUs
            </button>
            {gpuTypes.map((type) => (
              <button
                key={type}
                onClick={() => setFilter(type)}
                className={`px-6 py-2 rounded-full font-semibold transition-all cursor-pointer ${
                  filter === type
                    ? "bg-primary text-primary-foreground shadow-[0_0_20px_rgba(56,211,159,0.3)]"
                    : "bg-surface-low text-muted-foreground hover:bg-surface-high hover:text-white border border-border-medium"
                }`}
              >
                {getGPUDisplayName(type)}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Instance List */}
            <div className="lg:col-span-1 bg-surface-low border border-border-medium rounded-2xl overflow-hidden">
              <div className="max-h-[600px] overflow-y-auto">
                {filteredInstances.map((instance) => (
                  <button
                    key={instance.id}
                    onClick={() => setSelectedInstance(instance)}
                    className={`w-full text-left px-4 py-3 border-b border-border-medium hover:bg-surface-high transition-colors cursor-pointer ${
                      selectedInstance?.id === instance.id ? "bg-surface-high border-l-4 border-l-primary" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-white">
                        {instance.gpu_count}x {getGPUDisplayName(instance.gpu_type)}
                      </span>
                      {instance.minInterruptible && (
                        <span className="px-2 py-0.5 text-xs font-semibold rounded bg-primary/20 text-primary">
                          ${instance.minInterruptible.toFixed(2)}/hr
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted mt-1">
                      {instance.cpu_cores} vCPUs · {instance.memory_gb}GB RAM
                    </p>
                  </button>
                ))}
              </div>
            </div>

            {/* Instance Details */}
            <div className="lg:col-span-2">
              {selectedInstance ? (
                <div className="bg-surface-low border border-border-medium rounded-2xl p-8">
                  <div className="flex items-start justify-between mb-6">
                    <div>
                      <h3 className="text-2xl font-bold text-white">
                        {selectedInstance.gpu_count}x {getGPUDisplayName(selectedInstance.gpu_type)}
                      </h3>
                      <p className="text-sm font-mono text-muted mt-1">{selectedInstance.id}</p>
                    </div>
                    {GPU_INFO[selectedInstance.gpu_type.toUpperCase()] && (
                      <span className="px-3 py-1 text-sm font-semibold rounded-full bg-primary/10 text-primary border border-primary/20">
                        {GPU_INFO[selectedInstance.gpu_type.toUpperCase()].arch}
                      </span>
                    )}
                  </div>

                  {/* Specs Grid */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                    <div className="bg-background rounded-xl p-4 border border-border-medium">
                      <p className="text-sm text-muted mb-1">GPU Memory</p>
                      <p className="text-lg font-bold text-white">
                        {GPU_INFO[selectedInstance.gpu_type.toUpperCase()]?.vram || "N/A"}
                      </p>
                    </div>
                    <div className="bg-background rounded-xl p-4 border border-border-medium">
                      <p className="text-sm text-muted mb-1">vCPUs</p>
                      <p className="text-lg font-bold text-white">{selectedInstance.cpu_cores}</p>
                    </div>
                    <div className="bg-background rounded-xl p-4 border border-border-medium">
                      <p className="text-sm text-muted mb-1">RAM</p>
                      <p className="text-lg font-bold text-white">{selectedInstance.memory_gb} GB</p>
                    </div>
                    <div className="bg-background rounded-xl p-4 border border-border-medium">
                      <p className="text-sm text-muted mb-1">Storage</p>
                      <p className="text-lg font-bold text-white">
                        {selectedInstance.storage_gb >= 1000
                          ? `${(selectedInstance.storage_gb / 1000).toFixed(1)} TB`
                          : `${selectedInstance.storage_gb} GB`}
                      </p>
                    </div>
                  </div>

                  {/* Pricing by Region */}
                  <div className="border-t border-border-medium pt-6">
                    <h4 className="text-lg font-semibold text-white mb-4">Pricing by Region</h4>
                    <div className="space-y-3">
                      {Object.entries(selectedInstance.pricing).map(([region, prices]) => (
                        <div key={region} className="flex items-center justify-between p-4 bg-background rounded-xl border border-border-medium">
                          <div className="flex items-center gap-3">
                            <span className="text-2xl">{getRegionFlag(region)}</span>
                            <div>
                              <p className="font-semibold text-white">{getRegionName(region)}</p>
                              <p className="text-xs text-muted uppercase">{region}</p>
                            </div>
                          </div>
                          <div className="flex gap-4">
                            {prices["on-demand"] && (
                              <div className="text-right">
                                <p className="text-xs text-muted">On-Demand</p>
                                <p className="font-bold text-white">${prices["on-demand"].toFixed(2)}/hr</p>
                              </div>
                            )}
                            {prices.interruptable && (
                              <div className="text-right">
                                <p className="text-xs text-primary">Interruptible</p>
                                <p className="font-bold text-primary">${prices.interruptable.toFixed(2)}/hr</p>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Regions */}
                  <div className="mt-6 pt-6 border-t border-border-medium">
                    <h4 className="text-sm font-semibold text-muted uppercase mb-3">Available Regions</h4>
                    <div className="flex flex-wrap gap-2">
                      {selectedInstance.regions.map((region) => (
                        <span
                          key={region}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-surface-high text-secondary-foreground border border-border-medium"
                        >
                          <span>{getRegionFlag(region)}</span>
                          {getRegionName(region)}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-surface-low border border-border-medium rounded-2xl p-8 text-center text-muted">
                  Select an instance to view details
                </div>
              )}
            </div>
          </div>

          {/* CTA */}
          <div className="mt-16 text-center">
            <h3 className="text-3xl font-bold text-white mb-4">
              Ready to Deploy?
            </h3>
            <p className="text-lg text-muted-foreground mb-6 max-w-2xl mx-auto">
              Launch GPU instances in seconds. No commitments, pay as you go.
            </p>
            <button
              onClick={() => setIsModalOpen(true)}
              className="inline-flex items-center gap-2 bg-primary text-primary-foreground font-semibold py-3 px-8 rounded-lg text-lg hover:bg-primary-hover transition-colors shadow-[0_0_30px_rgba(56,211,159,0.3)] cursor-pointer"
            >
              Get Started
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        </div>
      </section>

      <ContactModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} source="gpus-get-started" />
    </>
  );
}
