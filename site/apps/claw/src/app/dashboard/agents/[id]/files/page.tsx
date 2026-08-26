import { redirect } from "next/navigation";

type AgentFilesRedirectPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstSearchParam(value: string | string[] | undefined): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate?.trim() || null;
}

export default async function AgentFilesRedirectPage({ params, searchParams }: AgentFilesRedirectPageProps) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const target = new URLSearchParams({ agentId: id, tab: "files" });
  const filePath = firstSearchParam(query.file);
  if (filePath) target.set("file", filePath);
  redirect(`/dashboard/agents?${target.toString()}`);
}
