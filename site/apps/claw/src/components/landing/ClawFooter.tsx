import { LandingFooterShell, type LandingFooterLinkGroup } from "@hypercli/shared-ui";
import { HyperCLILogoLink } from "@/components/HyperCLILogoLink";

const footerLinkGroups: LandingFooterLinkGroup[] = [
  {
    title: "Product",
    links: [
      { label: "Features", href: "#features" },
      { label: "Pricing", href: "#pricing" },
      { label: "Documentation", href: "https://docs.hypercli.com/hyperclaw" },
      { label: "API Reference", href: "https://docs.hypercli.com/hyperclaw" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "HyperCLI", href: "https://hypercli.com" },
      { label: "Contact", href: "mailto:support@hypercli.com" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy Policy", href: "/privacy" },
      { label: "Terms of Service", href: "/terms" },
    ],
  },
];

export function ClawFooter() {
  return (
    <LandingFooterShell
      brand={<HyperCLILogoLink className="h-[31px] w-[102px]" />}
      description={
        <>
          Unlimited agent inference.
          <br />
          Flat-rate. OpenAI-compatible.
        </>
      }
      linkGroups={footerLinkGroups}
      copyright={<>&copy; {new Date().getFullYear()} HyperCLI. All rights reserved.</>}
    />
  );
}
