import {
  createIntegrationClient,
  integrationDescribe,
  integrationIt,
} from "./helpers.js";

integrationDescribe("TS SDK integration: jobs", () => {
  integrationIt("lists jobs", async () => {
    const client = createIntegrationClient();
    const jobs = await client.jobs.list();

    expect(Array.isArray(jobs)).toBe(true);
  });

  integrationIt("creates a GPU job with dry_run enabled", async () => {
    const client = createIntegrationClient();
    const types = await client.instances.types(true);
    const firstType = Object.values(types)[0];

    expect(firstType).toBeDefined();

    const job = await client.jobs.create({
      image: "nvidia/cuda:12.0-base-ubuntu22.04",
      gpuType: firstType.id,
      command: "echo hello",
      runtime: 60,
      dryRun: true,
    });

    expect(job.jobId).toBe("dry-run");
    expect(job.jobKey).toBe("dry-run");
    expect(job.state.toLowerCase()).toBe("dry_run");
    expect(job.gpuType.toLowerCase()).toBe(firstType.id.toLowerCase());
    expect(job.runtime).toBe(60);
    expect(job.pricePerHour).toBeGreaterThan(0);
  });

  integrationIt("preserves constraints on dry-run jobs when constrained configs exist", async () => {
    const client = createIntegrationClient();
    const types = await client.instances.types(true);
    const constrainedType = Object.values(types).find((gpu) =>
      gpu.configs.some((config) => config.constraints),
    );

    if (!constrainedType) {
      return;
    }

    const constrainedConfig = constrainedType.configs.find((config) => config.constraints);
    if (!constrainedConfig) {
      return;
    }

    const job = await client.jobs.create({
      image: "nvidia/cuda:12.0-base-ubuntu22.04",
      gpuType: constrainedType.id,
      gpuCount: constrainedConfig.gpuCount,
      region: constrainedConfig.regions[0],
      constraints: constrainedConfig.constraints || undefined,
      command: "echo hello",
      runtime: 60,
      dryRun: true,
    });

    expect(job.jobId).toBe("dry-run");
    expect(job.constraints).toEqual(constrainedConfig.constraints);
  });
});
