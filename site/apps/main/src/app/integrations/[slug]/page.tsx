import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { IntegrationDetailPage } from "@/components/integrations/integration-detail-page";
import { getIntegrationDetail, INTEGRATION_DETAILS } from "@/content/integration-details";

interface IntegrationPageProps {
  params: Promise<{ slug: string }>;
}

export const dynamicParams = false;

export function generateStaticParams() {
  return INTEGRATION_DETAILS.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: IntegrationPageProps): Promise<Metadata> {
  const { slug } = await params;
  const detail = getIntegrationDetail(slug);
  if (!detail) return {};

  return {
    title: detail.metadataTitle ?? `${detail.name} + HyperCLI — Integration preview`,
    description: detail.description,
  };
}

export default async function IntegrationPage({ params }: IntegrationPageProps) {
  const { slug } = await params;
  const detail = getIntegrationDetail(slug);
  if (!detail) notFound();

  return <IntegrationDetailPage detail={detail} />;
}
