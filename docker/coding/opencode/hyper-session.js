// OpenCode 1.18.35: resolve each invocation against Backend's existing binding.
export default async () => ({
  "shell.env": async ({ sessionID }, output) => {
    output.env.HYPER_SESSION_ID = "";
    try {
      const url = new URL(process.env.HYPER_ACP_WS_URL);
      const token = process.env.HYPER_AGENTS_API_KEY;
      if (!token || !sessionID || !["ws:", "wss:"].includes(url.protocol)) throw new Error();
      url.protocol = url.protocol === "wss:" ? "https:" : "http:";
      url.pathname = "/agents/sessions/resolve";
      url.search = new URLSearchParams({ native_session_id: sessionID }).toString();
      url.hash = "";
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error();
      const { session_id } = await response.json();
      if (typeof session_id !== "string" || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(session_id)) throw new Error();
      output.env.HYPER_SESSION_ID = session_id;
    } catch {
      throw new Error("Cannot resolve HYPER_SESSION_ID for this native session");
    }
  },
});
