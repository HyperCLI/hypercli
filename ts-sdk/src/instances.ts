/**
 * Instances API - GPU types, regions, and pricing
 */
import type { HTTPClient } from './http.js';

export interface GPUConfig {
  gpuCount: number;
  cpuCores: number;
  memoryGb: number;
  storageGb: number;
  regions: string[];
}

export interface GPUType {
  id: string;
  name: string;
  description: string;
  configs: GPUConfig[];
}

export interface Region {
  id: string;
  description: string;
  country: string;
}

export interface PricingTier {
  region: string;
  onDemand: number | null;
  interruptible: number | null;
}

export interface GPUPricing {
  gpuType: string;
  gpuCount: number;
  tiers: PricingTier[];
}

export interface AvailableGPU {
  gpuType: string;
  gpuName: string;
  gpuCount: number;
  cpuCores: number;
  memoryGb: number;
  storageGb: number;
  region: string;
  regionName: string;
  country: string;
  priceSpot: number | null;
  priceOnDemand: number | null;
}

function gpuConfigFromDict(data: any): GPUConfig {
  return {
    gpuCount: data.gpu_count || 1,
    cpuCores: data.cpu_cores || 0,
    memoryGb: data.memory_gb || 0,
    storageGb: data.storage_gb || 0,
    regions: data.regions || [],
  };
}

function gpuTypeFromDict(id: string, data: any): GPUType {
  return {
    id,
    name: data.name || id,
    description: data.description || '',
    configs: (data.configs || []).map(gpuConfigFromDict),
  };
}

function regionFromDict(id: string, data: any): Region {
  return {
    id,
    description: data.description || id,
    country: data.country || '',
  };
}

function pricingTierFromDict(region: string, data: any): PricingTier {
  return {
    region,
    onDemand: data['on-demand'] ?? null,
    interruptible: data.interruptable ?? null, // Note: API has typo
  };
}

function gpuPricingFromKey(key: string, data: any): GPUPricing {
  // Parse key like "h100_x8" -> gpu_type="h100", gpu_count=8
  const parts = key.split('_x');
  const gpuType = parts[0];
  const gpuCount = parts.length > 1 ? parseInt(parts[1]) : 1;

  const tiers = Object.entries(data).map(([region, prices]) =>
    pricingTierFromDict(region, prices)
  );

  return { gpuType, gpuCount, tiers };
}

export class Instances {
  private typesCache: Record<string, GPUType> | null = null;
  private regionsCache: Record<string, Region> | null = null;
  private pricingCache: Record<string, GPUPricing> | null = null;

  constructor(private http: HTTPClient) {}

  /**
   * Get available GPU types
   */
  async types(refresh: boolean = false): Promise<Record<string, GPUType>> {
    if (this.typesCache === null || refresh) {
      const data = await this.http.get('/instances/types');
      this.typesCache = {};
      for (const [id, info] of Object.entries(data)) {
        this.typesCache[id] = gpuTypeFromDict(id, info);
      }
    }
    return this.typesCache;
  }

  /**
   * Get available regions
   */
  async regions(refresh: boolean = false): Promise<Record<string, Region>> {
    if (this.regionsCache === null || refresh) {
      const data = await this.http.get('/instances/regions');
      this.regionsCache = {};
      for (const [id, info] of Object.entries(data)) {
        this.regionsCache[id] = regionFromDict(id, info);
      }
    }
    return this.regionsCache;
  }

  /**
   * Get pricing information
   */
  async pricing(refresh: boolean = false): Promise<Record<string, GPUPricing>> {
    if (this.pricingCache === null || refresh) {
      const data = await this.http.get('/instances/pricing');
      this.pricingCache = {};
      for (const [key, prices] of Object.entries(data)) {
        this.pricingCache[key] = gpuPricingFromKey(key, prices);
      }
    }
    return this.pricingCache;
  }

  /**
   * Get a specific GPU type by ID
   */
  async getType(gpuType: string): Promise<GPUType | null> {
    const types = await this.types();
    return types[gpuType] || null;
  }

  /**
   * Get a specific region by ID
   */
  async getRegion(regionId: string): Promise<Region | null> {
    const regions = await this.regions();
    return regions[regionId] || null;
  }

  /**
   * Get price for a specific GPU configuration
   */
  async getPrice(
    gpuType: string,
    gpuCount: number = 1,
    region?: string,
    interruptible: boolean = true
  ): Promise<number | null> {
    const key = `${gpuType}_x${gpuCount}`;
    const pricing = await this.pricing();
    const gpuPricing = pricing[key];

    if (gpuPricing && region) {
      for (const tier of gpuPricing.tiers) {
        if (tier.region === region) {
          return interruptible ? tier.interruptible : tier.onDemand;
        }
      }
    }

    return null;
  }

  /**
   * Get real-time GPU capacity by type and region
   */
  async capacity(gpuType?: string): Promise<any> {
    const params: Record<string, string> = {};
    if (gpuType) {
      params.gpu_type = gpuType;
    }
    return await this.http.get('/api/jobs/instances/capacity', params);
  }

  /**
   * List available GPU configurations, optionally filtered
   */
  async listAvailable(gpuType?: string, region?: string): Promise<AvailableGPU[]> {
    const types = await this.types();
    const regions = await this.regions();
    const pricing = await this.pricing();

    const results: AvailableGPU[] = [];

    for (const [typeId, gpu] of Object.entries(types)) {
      if (gpuType && typeId !== gpuType) continue;

      for (const config of gpu.configs) {
        if (!config.regions.length) continue;
        if (region && !config.regions.includes(region)) continue;

        const key = `${typeId}_x${config.gpuCount}`;
        const gpuPricing = pricing[key];

        for (const r of config.regions) {
          if (region && r !== region) continue;

          const regionInfo = regions[r];
          let priceSpot: number | null = null;
          let priceOnDemand: number | null = null;

          if (gpuPricing) {
            for (const tier of gpuPricing.tiers) {
              if (tier.region === r) {
                priceSpot = tier.interruptible;
                priceOnDemand = tier.onDemand;
                break;
              }
            }
          }

          results.push({
            gpuType: typeId,
            gpuName: gpu.name,
            gpuCount: config.gpuCount,
            cpuCores: config.cpuCores,
            memoryGb: config.memoryGb,
            storageGb: config.storageGb,
            region: r,
            regionName: regionInfo?.description || r,
            country: regionInfo?.country || '',
            priceSpot,
            priceOnDemand,
          });
        }
      }
    }

    return results;
  }

  /**
   * Get available regions for a GPU type and count
   */
  availableRegions(gpu: GPUType, gpuCount: number = 1): string[] {
    for (const config of gpu.configs) {
      if (config.gpuCount === gpuCount) {
        return config.regions;
      }
    }
    return [];
  }

  /**
   * Get available GPU counts for a type
   */
  availableCounts(gpu: GPUType): number[] {
    return gpu.configs.filter(c => c.regions.length > 0).map(c => c.gpuCount);
  }
}
