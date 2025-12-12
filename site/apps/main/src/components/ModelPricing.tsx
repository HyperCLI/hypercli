"use client";

import { useEffect, useState } from "react";
import { ContactModal } from "@hypercli/shared-ui";

interface ModelInfo {
  name: string;
  description: string;
  context_length: number;
  external: boolean;
}

interface ModelPricing {
  max_tokens: number;
  input_cost_per_token: string;
  output_cost_per_token: string;
  input_price_per_1m: string;
  output_price_per_1m: string;
}

interface ModelGroups {
  "free-models": string[];
  "c3-models": string[];
  "external-models": string[];
}

interface Model {
  id: string;
  name: string;
  description: string;
  context_length: number;
  hosted: boolean;
  free: boolean;
  pricing?: ModelPricing;
}

export default function ModelPricing() {
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<Model | null>(null);
  const [filter, setFilter] = useState<"all" | "hosted" | "external">("all");
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const apiBase = process.env.NEXT_PUBLIC_LLM_API_URL?.replace('/v1', '') || 'https://api.hypercli.com';
        const [modelsRes, pricingRes, groupsRes] = await Promise.all([
          fetch(`${apiBase}/llm/models`),
          fetch(`${apiBase}/llm/pricing`),
          fetch(`${apiBase}/llm/groups`),
        ]);

        const modelsData: Record<string, ModelInfo> = await modelsRes.json();
        const pricingData: Record<string, ModelPricing> = await pricingRes.json();
        const groupsData: ModelGroups = await groupsRes.json();

        const hostedModels = new Set([
          ...groupsData["free-models"],
          ...groupsData["c3-models"],
        ]);
        const freeModels = new Set(groupsData["free-models"]);

        const modelArray: Model[] = Object.entries(modelsData).map(([id, info]) => ({
          id,
          name: info.name,
          description: info.description,
          context_length: info.context_length,
          hosted: hostedModels.has(id),
          free: freeModels.has(id),
          pricing: pricingData[id],
        }));

        modelArray.sort((a, b) => {
          if (a.hosted && !b.hosted) return -1;
          if (!a.hosted && b.hosted) return 1;
          if (a.free && !b.free) return -1;
          if (!a.free && b.free) return 1;
          return a.name.localeCompare(b.name);
        });

        setModels(modelArray);
        setSelectedModel(modelArray[0] || null);
        setLoading(false);
      } catch (err) {
        setError("Failed to load models");
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const filteredModels = models.filter((m) => {
    if (filter === "hosted") return m.hosted;
    if (filter === "external") return !m.hosted;
    return true;
  });

  if (loading) {
    return (
      <div className="py-20 text-center">
        <div className="inline-block h-12 w-12 animate-spin rounded-full border-4 border-solid border-[#38D39F] border-r-transparent"></div>
        <p className="mt-4 text-[#9BA0A2]">Loading models...</p>
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
      <section className="py-4 sm:py-6 bg-[#0B0D0E]">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
          {/* Filter Tabs */}
          <div className="flex justify-center gap-3 mb-8">
            {[
              { key: "all", label: "All Models" },
              { key: "hosted", label: "HyperCLI Hosted" },
              { key: "external", label: "External" },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setFilter(key as typeof filter)}
                className={`px-6 py-2 rounded-full font-semibold transition-all ${
                  filter === key
                    ? "bg-[#38D39F] text-[#0B0D0E] shadow-[0_0_20px_rgba(56,211,159,0.3)]"
                    : "bg-[#161819] text-[#9BA0A2] hover:bg-[#1D1F21] hover:text-white border border-[#2A2D2F]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Model List */}
            <div className="lg:col-span-1 bg-[#161819] border border-[#2A2D2F] rounded-2xl overflow-hidden">
              <div className="max-h-[600px] overflow-y-auto">
                {filteredModels.map((model) => (
                  <button
                    key={model.id}
                    onClick={() => setSelectedModel(model)}
                    className={`w-full text-left px-4 py-3 border-b border-[#2A2D2F] hover:bg-[#1D1F21] transition-colors ${
                      selectedModel?.id === model.id ? "bg-[#1D1F21] border-l-4 border-l-[#38D39F]" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-white text-sm">{model.id}</span>
                      <div className="flex gap-1">
                        {model.free && (
                          <span className="px-2 py-0.5 text-xs font-semibold rounded bg-[#38D39F]/20 text-[#38D39F]">
                            FREE
                          </span>
                        )}
                        {model.hosted && !model.free && (
                          <span className="px-2 py-0.5 text-xs font-semibold rounded bg-[#38D39F]/10 text-[#38D39F]/80 border border-[#38D39F]/20">
                            HOSTED
                          </span>
                        )}
                        {!model.hosted && (
                          <span className="px-2 py-0.5 text-xs font-semibold rounded bg-[#1D1F21] text-[#6E7375] border border-[#2A2D2F]">
                            EXT
                          </span>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-[#6E7375] truncate mt-1">{model.name}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Model Details */}
            <div className="lg:col-span-2">
              {selectedModel ? (
                <div className="bg-[#161819] border border-[#2A2D2F] rounded-2xl p-8">
                  <div className="flex items-start justify-between mb-6">
                    <div>
                      <h3 className="text-2xl font-bold text-white">{selectedModel.name}</h3>
                      <p className="text-sm font-mono text-[#6E7375] mt-1">{selectedModel.id}</p>
                    </div>
                    <div className="flex gap-2">
                      {selectedModel.free && (
                        <span className="px-3 py-1 text-sm font-semibold rounded-full bg-[#38D39F]/20 text-[#38D39F]">
                          Free Tier
                        </span>
                      )}
                      <span
                        className={`px-3 py-1 text-sm font-semibold rounded-full ${
                          selectedModel.hosted
                            ? "bg-[#38D39F]/10 text-[#38D39F] border border-[#38D39F]/20"
                            : "bg-[#1D1F21] text-[#6E7375] border border-[#2A2D2F]"
                        }`}
                      >
                        {selectedModel.hosted ? "HyperCLI Hosted" : "External"}
                      </span>
                    </div>
                  </div>

                  <p className="text-[#9BA0A2] mb-8 leading-relaxed">{selectedModel.description}</p>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                    <div className="bg-[#0B0D0E] rounded-xl p-4 border border-[#2A2D2F]">
                      <p className="text-sm text-[#6E7375] mb-1">Context Length</p>
                      <p className="text-2xl font-bold text-white">
                        {(selectedModel.context_length / 1000).toLocaleString()}K
                        <span className="text-sm font-normal text-[#6E7375] ml-1">tokens</span>
                      </p>
                    </div>

                    {selectedModel.pricing && (
                      <div className="bg-[#0B0D0E] rounded-xl p-4 border border-[#2A2D2F]">
                        <p className="text-sm text-[#6E7375] mb-1">Max Output Tokens</p>
                        <p className="text-2xl font-bold text-white">
                          {(selectedModel.pricing.max_tokens / 1000).toLocaleString()}K
                        </p>
                      </div>
                    )}
                  </div>

                  {selectedModel.pricing && (
                    <div className="border-t border-[#2A2D2F] pt-6">
                      <h4 className="text-lg font-semibold text-white mb-4">Pricing</h4>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="bg-[#0B0D0E] rounded-xl p-4 border border-[#2A2D2F]">
                          <p className="text-sm text-[#38D39F] mb-1">Input</p>
                          <p className="text-2xl font-bold text-white">
                            ${selectedModel.pricing.input_price_per_1m}
                            <span className="text-sm font-normal text-[#6E7375] ml-1">/1M tokens</span>
                          </p>
                        </div>
                        <div className="bg-[#0B0D0E] rounded-xl p-4 border border-[#2A2D2F]">
                          <p className="text-sm text-[#38D39F] mb-1">Output</p>
                          <p className="text-2xl font-bold text-white">
                            ${selectedModel.pricing.output_price_per_1m}
                            <span className="text-sm font-normal text-[#6E7375] ml-1">/1M tokens</span>
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-[#161819] border border-[#2A2D2F] rounded-2xl p-8 text-center text-[#6E7375]">
                  Select a model to view details
                </div>
              )}
            </div>
          </div>

          {/* CTA */}
          <div className="mt-16 text-center">
            <h3 className="text-3xl font-bold text-white mb-4">
              Ready to Access Every Model?
            </h3>
            <p className="text-lg text-[#9BA0A2] mb-6 max-w-2xl mx-auto">
              Drop-in API replacement. Compatible with OpenAI SDK. Hosted on B200 GPUs.
            </p>
            <button
              onClick={() => setIsModalOpen(true)}
              className="inline-flex items-center gap-2 bg-[#38D39F] text-[#0B0D0E] font-semibold py-3 px-8 rounded-lg text-lg hover:bg-[#45E4AE] transition-colors shadow-[0_0_30px_rgba(56,211,159,0.3)]"
            >
              Get API Access
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        </div>
      </section>

      <ContactModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} source="models-api-access" />
    </>
  );
}
