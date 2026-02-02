"use client";

const footerLinks = {
  Product: [
    { label: "Features", href: "#features" },
    { label: "Pricing", href: "#pricing" },
    { label: "Documentation", href: "https://docs.hyperclaw.app" },
    { label: "API Reference", href: "https://docs.hyperclaw.app/api" },
  ],
  Company: [
    { label: "HyperCLI", href: "https://hypercli.com" },
    { label: "Blog", href: "https://hypercli.com/blog" },
    { label: "Contact", href: "mailto:support@hyperclaw.app" },
  ],
  Legal: [
    { label: "Privacy Policy", href: "/privacy" },
    { label: "Terms of Service", href: "/terms" },
  ],
};

export function ClawFooter() {
  return (
    <footer className="border-t border-border bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="col-span-2 md:col-span-1">
            <span className="text-lg font-bold">
              <span className="text-foreground">Hyper</span>
              <span className="text-primary">Claw</span>
            </span>
            <p className="text-sm text-text-muted mt-2 leading-relaxed">
              Unlimited agent inference.
              <br />
              Flat-rate. OpenAI-compatible.
            </p>
          </div>

          {/* Link columns */}
          {Object.entries(footerLinks).map(([category, links]) => (
            <div key={category}>
              <h4 className="text-sm font-semibold text-foreground mb-3">
                {category}
              </h4>
              <ul className="space-y-2">
                {links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      className="text-sm text-text-muted hover:text-foreground transition-colors"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="border-t border-border mt-8 pt-8 text-center">
          <p className="text-xs text-text-muted">
            &copy; {new Date().getFullYear()} HyperClaw. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
