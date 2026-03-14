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
    const job = await client.jobs.create({
      image: "nvidia/cuda:12.0-base-ubuntu22.04",
      gpuType: "l4",
      command: "echo hello",
      runtime: 60,
      dryRun: true,
    });

    expect(job.jobId).toBe("dry-run");
    expect(job.jobKey).toBe("dry-run");
    expect(job.state.toLowerCase()).toBe("dry_run");
    expect(job.gpuType.toLowerCase()).toBe("l4");
    expect(job.runtime).toBe(60);
    expect(job.pricePerHour).toBeGreaterThan(0);
  });
});
