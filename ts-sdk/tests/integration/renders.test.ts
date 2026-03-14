import {
  createIntegrationClient,
  integrationDescribe,
  integrationIt,
} from "./helpers.js";

integrationDescribe("TS SDK integration: renders", () => {
  integrationIt("lists existing renders", async () => {
    const client = createIntegrationClient();
    const renders = await client.renders.list();

    expect(Array.isArray(renders)).toBe(true);
    if (renders.length > 0) {
      const render = renders[0];
      expect(render.renderId).toBeTruthy();
      expect(render.state).toBeTruthy();
    }
  });
});
