import { Metadata } from "next";
import { ClawHeader } from "@/components/landing/ClawHeader";
import { ClawFooter } from "@/components/landing/ClawFooter";

export const metadata: Metadata = {
  title: "Privacy Policy - HyperClaw",
  description: "HyperClaw Privacy Policy",
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      <ClawHeader />
      <main className="pt-24 pb-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <h1 className="text-4xl font-bold text-foreground mb-4">
            Privacy Policy
          </h1>
          <p className="text-text-muted mb-8">Last Updated: February 4, 2025</p>

          <div className="prose prose-invert max-w-none space-y-8">
            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">
                1. Introduction
              </h2>
              <p className="text-text-secondary leading-relaxed">
                HyperClaw (&quot;HyperClaw&quot;, &quot;we&quot;, &quot;us&quot;, or &quot;our&quot;) provides a platform
                for GPU orchestration, AI inference, and related developer tools.
                This Privacy Policy describes how we collect, use, and protect your
                information when you use our platform and related services (the
                &quot;Services&quot;).
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">
                2. Information We Collect
              </h2>

              <h3 className="text-xl font-medium text-foreground mt-6 mb-3">
                2.1 Account Information
              </h3>
              <p className="text-text-secondary leading-relaxed">
                When you create an account, we collect the following depending
                on your authentication method:
              </p>
              <ul className="list-disc list-inside text-text-secondary mt-4 space-y-2">
                <li>
                  <strong className="text-foreground">Email authentication:</strong>{" "}
                  Your email address
                </li>
                <li>
                  <strong className="text-foreground">Wallet authentication:</strong>{" "}
                  Your public wallet address
                </li>
              </ul>
              <p className="text-text-secondary leading-relaxed mt-4">
                Authentication is handled by Privy, a third-party identity provider.
                We do not store passwords or private keys.
              </p>

              <h3 className="text-xl font-medium text-foreground mt-6 mb-3">
                2.2 Payment Information
              </h3>
              <p className="text-text-secondary leading-relaxed">
                We do not directly process or store payment card details. Payments
                are handled by:
              </p>
              <ul className="list-disc list-inside text-text-secondary mt-4 space-y-2">
                <li>
                  <strong className="text-foreground">Stripe:</strong>{" "}
                  For credit and debit card transactions. Stripe is PCI-DSS Level 1
                  certified. We receive transaction confirmations and billing addresses,
                  not card numbers.
                </li>
                <li>
                  <strong className="text-foreground">Blockchain networks:</strong>{" "}
                  For cryptocurrency payments. Transactions occur on-chain via your
                  wallet. We receive transaction hashes for payment verification.
                </li>
              </ul>

              <h3 className="text-xl font-medium text-foreground mt-6 mb-3">
                2.3 API Usage Data
              </h3>
              <p className="text-text-secondary leading-relaxed">
                When you use our API, we collect operational metadata:
              </p>
              <ul className="list-disc list-inside text-text-secondary mt-4 space-y-2">
                <li>Request timestamps</li>
                <li>Token counts (input and output)</li>
                <li>Model identifiers</li>
                <li>Response latency</li>
                <li>Error codes (when applicable)</li>
              </ul>
              <p className="text-text-secondary leading-relaxed mt-4">
                This metadata is used for billing, rate limiting, and service
                monitoring. It does not include the content of your prompts or
                model responses.
              </p>

              <h3 className="text-xl font-medium text-foreground mt-6 mb-3">
                2.4 Technical Information
              </h3>
              <p className="text-text-secondary leading-relaxed">
                We collect standard technical data for security and operations:
              </p>
              <ul className="list-disc list-inside text-text-secondary mt-4 space-y-2">
                <li>IP addresses (for rate limiting and fraud prevention)</li>
                <li>API key identifiers (not the keys themselves)</li>
                <li>Request headers required for API operation</li>
              </ul>

              <h3 className="text-xl font-medium text-foreground mt-6 mb-3">
                2.5 Communications
              </h3>
              <p className="text-text-secondary leading-relaxed">
                If you contact us for support or feedback, we retain those
                communications to provide assistance and improve our Services.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">
                3. How We Use Your Information
              </h2>
              <p className="text-text-secondary leading-relaxed">
                We use collected information to:
              </p>
              <ul className="list-disc list-inside text-text-secondary mt-4 space-y-2">
                <li>Provide, operate, and maintain the Services</li>
                <li>Process transactions and calculate billing</li>
                <li>Enforce rate limits and usage quotas</li>
                <li>Detect, prevent, and respond to fraud or abuse</li>
                <li>Send transactional communications (receipts, alerts, service updates)</li>
                <li>Respond to support requests</li>
                <li>Comply with legal obligations</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">
                4. Data Retention
              </h2>

              <h3 className="text-xl font-medium text-foreground mt-6 mb-3">
                4.1 Prompt and Completion Data
              </h3>
              <p className="text-text-secondary leading-relaxed">
                <strong className="text-foreground">We do not store the content of your API requests or responses.</strong>{" "}
                Prompts and completions are processed in real-time and are not
                persisted after the request completes. We do not retain logs of
                what you send to or receive from the models.
              </p>
              <p className="text-text-secondary leading-relaxed mt-4">
                <strong className="text-foreground">We do not use your data for model training.</strong>{" "}
                Your prompts, completions, and any data you transmit through our
                API are never used to train, fine-tune, or improve AI models.
              </p>

              <h3 className="text-xl font-medium text-foreground mt-6 mb-3">
                4.2 Other Data
              </h3>
              <ul className="list-disc list-inside text-text-secondary mt-4 space-y-2">
                <li>
                  <strong className="text-foreground">Usage metadata:</strong>{" "}
                  Retained for the duration of your account plus any period required
                  for billing reconciliation and legal compliance.
                </li>
                <li>
                  <strong className="text-foreground">Account information:</strong>{" "}
                  Retained until you delete your account.
                </li>
                <li>
                  <strong className="text-foreground">Payment records:</strong>{" "}
                  Retained as required by tax and financial regulations (typically 7 years).
                </li>
                <li>
                  <strong className="text-foreground">Security logs:</strong>{" "}
                  IP addresses and access patterns retained for up to 90 days for
                  fraud prevention.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">
                5. Information Sharing
              </h2>
              <p className="text-text-secondary leading-relaxed">
                We do not sell your personal information. We share information
                only in the following circumstances:
              </p>

              <h3 className="text-xl font-medium text-foreground mt-6 mb-3">
                5.1 Service Providers
              </h3>
              <p className="text-text-secondary leading-relaxed">
                We use third-party services to operate the platform:
              </p>
              <ul className="list-disc list-inside text-text-secondary mt-4 space-y-2">
                <li>
                  <strong className="text-foreground">Privy</strong> — Identity
                  and authentication. Handles login credentials and wallet connections.
                </li>
                <li>
                  <strong className="text-foreground">Stripe</strong> — Payment
                  processing for card transactions.
                </li>
                <li>
                  <strong className="text-foreground">Cloud infrastructure providers</strong> — For
                  hosting and data storage. Data is encrypted at rest.
                </li>
              </ul>
              <p className="text-text-secondary leading-relaxed mt-4">
                These providers are contractually bound to use your information
                only to provide services to us and to maintain appropriate security.
              </p>

              <h3 className="text-xl font-medium text-foreground mt-6 mb-3">
                5.2 Legal Requirements
              </h3>
              <p className="text-text-secondary leading-relaxed">
                We may disclose information if required by law, subpoena, or
                other legal process, or if we believe disclosure is necessary to:
              </p>
              <ul className="list-disc list-inside text-text-secondary mt-4 space-y-2">
                <li>Comply with applicable law or legal process</li>
                <li>Protect the rights, property, or safety of HyperClaw, our users, or others</li>
                <li>Detect, prevent, or address fraud, security, or technical issues</li>
              </ul>

              <h3 className="text-xl font-medium text-foreground mt-6 mb-3">
                5.3 Business Transfers
              </h3>
              <p className="text-text-secondary leading-relaxed">
                In the event of a merger, acquisition, or sale of assets, your
                information may be transferred as part of that transaction. We
                will notify you of any such change and any choices you may have.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">
                6. Cookies and Browser Storage
              </h2>
              <p className="text-text-secondary leading-relaxed">
                We use minimal browser storage to operate the Services:
              </p>
              <ul className="list-disc list-inside text-text-secondary mt-4 space-y-2">
                <li>
                  <strong className="text-foreground">Authentication tokens:</strong>{" "}
                  Stored in localStorage to maintain your logged-in session.
                </li>
                <li>
                  <strong className="text-foreground">Essential cookies:</strong>{" "}
                  Used by Privy and Stripe for authentication and payment flows.
                </li>
              </ul>
              <p className="text-text-secondary leading-relaxed mt-4">
                We do not use advertising cookies, tracking pixels, or third-party
                analytics services on the HyperClaw platform.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">
                7. Data Security
              </h2>
              <p className="text-text-secondary leading-relaxed">
                We implement technical and organizational measures to protect your
                information:
              </p>
              <ul className="list-disc list-inside text-text-secondary mt-4 space-y-2">
                <li>All data transmitted to and from our API is encrypted using TLS 1.2+</li>
                <li>Data at rest is encrypted using AES-256</li>
                <li>API keys are hashed; we cannot retrieve your original key</li>
                <li>Access to production systems is restricted and logged</li>
                <li>Infrastructure is hosted in SOC 2 compliant data centers</li>
              </ul>
              <p className="text-text-secondary leading-relaxed mt-4">
                While we strive to protect your information, no method of electronic
                transmission or storage is completely secure. We cannot guarantee
                absolute security.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">
                8. Your Rights and Choices
              </h2>
              <p className="text-text-secondary leading-relaxed">
                Depending on your jurisdiction, you may have certain rights regarding
                your personal information:
              </p>
              <ul className="list-disc list-inside text-text-secondary mt-4 space-y-2">
                <li>
                  <strong className="text-foreground">Access:</strong> Request a copy
                  of the personal information we hold about you
                </li>
                <li>
                  <strong className="text-foreground">Correction:</strong> Request
                  correction of inaccurate information
                </li>
                <li>
                  <strong className="text-foreground">Deletion:</strong> Request
                  deletion of your account and associated data
                </li>
                <li>
                  <strong className="text-foreground">Portability:</strong> Request
                  your data in a machine-readable format
                </li>
                <li>
                  <strong className="text-foreground">Restriction:</strong> Request
                  that we limit processing of your information
                </li>
              </ul>
              <p className="text-text-secondary leading-relaxed mt-4">
                To exercise these rights, contact us at{" "}
                <a
                  href="mailto:support@hypercli.com"
                  className="text-primary hover:underline"
                >
                  support@hypercli.com
                </a>
                . We will respond within 30 days. We may need to verify your identity
                before processing certain requests.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">
                9. International Data Transfers
              </h2>
              <p className="text-text-secondary leading-relaxed">
                Our Services are operated from the United States. If you access
                the Services from outside the United States, your information may
                be transferred to, stored, and processed in the United States or
                other countries where our infrastructure or service providers are
                located. By using the Services, you consent to such transfers.
              </p>
              <p className="text-text-secondary leading-relaxed mt-4">
                For users in the European Economic Area, we rely on Standard
                Contractual Clauses or other lawful transfer mechanisms where
                required.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">
                10. Age Requirements
              </h2>
              <p className="text-text-secondary leading-relaxed">
                The Services are intended for users who are at least 18 years old.
                We do not knowingly collect personal information from anyone under
                18. If we learn that we have collected information from a user under
                18, we will delete it promptly.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">
                11. Changes to This Policy
              </h2>
              <p className="text-text-secondary leading-relaxed">
                We may update this Privacy Policy from time to time to reflect
                changes in our practices or legal requirements. If we make material
                changes, we will notify you by email (if you have provided one) or
                by posting a prominent notice on the platform prior to the change
                becoming effective.
              </p>
              <p className="text-text-secondary leading-relaxed mt-4">
                We encourage you to review this policy periodically. The &quot;Last
                Updated&quot; date at the top indicates when the policy was last revised.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">
                12. Contact Us
              </h2>
              <p className="text-text-secondary leading-relaxed">
                If you have questions about this Privacy Policy or wish to exercise
                your data rights, please contact us:
              </p>
              <div className="mt-4 text-text-secondary space-y-2">
                <p>
                  <strong className="text-foreground">Email:</strong>{" "}
                  <a
                    href="mailto:support@hypercli.com"
                    className="text-primary hover:underline"
                  >
                    support@hypercli.com
                  </a>
                </p>
                <p className="mt-4">
                  HyperCLI
                </p>
              </div>
            </section>
          </div>
        </div>
      </main>
      <ClawFooter />
    </div>
  );
}
