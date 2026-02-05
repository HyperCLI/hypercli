import { Metadata } from "next";
import { Header, Footer } from "@hypercli/shared-ui";

export const metadata: Metadata = {
  title: "Terms of Service - HyperCLI",
  description: "HyperCLI Terms of Service",
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="pt-24 pb-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <h1 className="text-4xl font-bold text-foreground mb-4">
            Terms of Service
          </h1>
          <p className="text-muted-foreground mb-8">Last Updated: February 5, 2025</p>

          <div className="prose prose-invert max-w-none space-y-8 text-muted-foreground leading-relaxed">
            <section>
              <p>
                These Terms of Service (this &quot;Agreement&quot;) apply to your access
                and use of the HyperCLI platform, websites, APIs, SDK, CLI,
                documentation, and related services (collectively, the &quot;Services&quot;).
                &quot;We&quot;, &quot;HyperCLI&quot;, and &quot;us&quot; mean HyperCLI, Inc., the provider of
                the Services. The terms &quot;User&quot; and &quot;you&quot; mean any user of the
                Services.
              </p>
              <p className="mt-4">
                By accessing or using the Services, you agree to be bound by this
                Agreement. If you do not agree to these terms, you must not use
                the Services.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">
                1. Services Overview
              </h2>
              <p>
                HyperCLI provides GPU orchestration, LLM inference APIs, image
                and video generation (Render API), and related developer tools.
                You may access the Services through our API, SDK, CLI, web console,
                or other interfaces we provide.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">
                2. Account Registration
              </h2>
              <p>
                To use certain features of the Services, you must create an account.
                When registering, you must provide accurate and complete information.
                You are responsible for maintaining the confidentiality of your
                account credentials and API keys, and for all activities that occur
                under your account.
              </p>
              <p className="mt-4">
                You agree to immediately notify us of any unauthorized use of your
                account or API keys. API keys are confidential credentials and must
                not be shared outside your organization or beyond authorized users.
              </p>
              <p className="mt-4">
                You represent that you are at least 18 years of age. If you are
                using the Services on behalf of an organization, you represent
                that you have the authority to bind that organization to this
                Agreement.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">
                3. Acceptable Use
              </h2>
              <p>
                You agree to use the Services only for lawful purposes and in
                accordance with this Agreement. You agree not to:
              </p>
              <ul className="list-disc list-inside mt-4 space-y-2">
                <li>Generate illegal, harmful, threatening, abusive, harassing, defamatory, or otherwise objectionable content</li>
                <li>Violate any applicable laws, regulations, or third-party rights</li>
                <li>Attempt to circumvent rate limits, access controls, or security measures</li>
                <li>Reverse engineer, decompile, or attempt to extract the underlying models or algorithms</li>
                <li>Resell, redistribute, or sublicense access to the Services without authorization</li>
                <li>Use the Services to develop competing products or services</li>
                <li>Interfere with or disrupt the integrity or performance of the Services</li>
                <li>Attempt to gain unauthorized access to any systems or networks connected to the Services</li>
                <li>Use the Services to send spam or unsolicited communications</li>
                <li>Upload malware, viruses, or other malicious code</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">
                4. User Content
              </h2>
              <p>
                You may submit prompts, data, files, and other content through
                the Services (&quot;User Content&quot;). You retain ownership of your
                User Content. By submitting User Content, you grant HyperCLI a
                limited license to process such content solely to provide the
                Services to you.
              </p>
              <p className="mt-4">
                You are responsible for ensuring that your User Content complies
                with applicable laws and does not infringe on the rights of third
                parties. You represent that you own or have obtained the necessary
                rights and permissions to use and submit your User Content.
              </p>
              <p className="mt-4">
                As described in our Privacy Policy, we do not store User Content
                beyond what is necessary to process your requests in real-time,
                and we do not use User Content to train AI models.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">
                5. Fees and Payment
              </h2>
              <p>
                Certain features of the Services require payment. Pricing is
                displayed on our website and in the console. You agree to pay
                all fees associated with your use of the Services.
              </p>
              <p className="mt-4">
                Payments are processed by Stripe or via cryptocurrency. By providing
                payment information, you authorize us to charge your payment method
                for fees incurred. You are responsible for any fees charged by your
                payment provider.
              </p>
              <p className="mt-4">
                We reserve the right to modify pricing at any time. We will notify
                you of price changes before they take effect. Continued use of
                paid Services after a price change constitutes acceptance of the
                new pricing.
              </p>
              <p className="mt-4">
                If payment fails or your balance is insufficient, we may suspend
                your access to the Services until payment is received.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">
                6. Intellectual Property
              </h2>
              <p>
                The Services, including all software, documentation, APIs, and
                content provided by HyperCLI (excluding User Content), are owned
                by HyperCLI and are protected by intellectual property laws.
              </p>
              <p className="mt-4">
                Subject to your compliance with this Agreement, we grant you a
                limited, non-exclusive, non-transferable license to access and
                use the Services for your internal business purposes.
              </p>
              <p className="mt-4">
                You may not copy, modify, distribute, sell, or lease any part of
                the Services, nor may you reverse engineer or attempt to extract
                the source code, except as permitted by law.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">
                7. Third-Party Services
              </h2>
              <p>
                The Services may integrate with or rely on third-party services,
                including AI model providers, cloud infrastructure, and payment
                processors. We are not responsible for the availability, accuracy,
                or policies of third-party services.
              </p>
              <p className="mt-4">
                Your use of third-party services may be subject to additional terms
                and conditions. We encourage you to review the terms of any
                third-party services you use in connection with our Services.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">
                8. Service Availability
              </h2>
              <p>
                We strive to provide reliable Services, but we do not guarantee
                that the Services will be available at all times or without
                interruption. We may modify, suspend, or discontinue any part of
                the Services at any time, with or without notice.
              </p>
              <p className="mt-4">
                We reserve the right to modify API endpoints, rate limits, available
                models, features, and other aspects of the Services. We will make
                reasonable efforts to notify you of material changes.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">
                9. Termination
              </h2>
              <p>
                You may cancel your account at any time through the console or by
                contacting support. Upon cancellation, your access to the Services
                will terminate.
              </p>
              <p className="mt-4">
                We may suspend or terminate your access to the Services at any
                time, with or without cause, including if we believe you have
                violated this Agreement. Upon termination, your right to use the
                Services immediately ceases.
              </p>
              <p className="mt-4">
                Sections of this Agreement that by their nature should survive
                termination will survive, including intellectual property,
                limitation of liability, and dispute resolution provisions.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">
                10. Disclaimer of Warranties
              </h2>
              <p className="uppercase">
                THE SERVICES ARE PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot; WITHOUT
                WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED. TO THE FULLEST
                EXTENT PERMITTED BY LAW, HYPERCLI DISCLAIMS ALL WARRANTIES,
                INCLUDING IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
                PARTICULAR PURPOSE, AND NON-INFRINGEMENT.
              </p>
              <p className="mt-4 uppercase">
                WE DO NOT WARRANT THAT THE SERVICES WILL BE UNINTERRUPTED,
                ERROR-FREE, OR SECURE, OR THAT ANY DEFECTS WILL BE CORRECTED.
                AI MODEL OUTPUTS MAY CONTAIN ERRORS, INACCURACIES, OR INAPPROPRIATE
                CONTENT. YOU ARE SOLELY RESPONSIBLE FOR EVALUATING AND USING ANY
                OUTPUT FROM THE SERVICES.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">
                11. Limitation of Liability
              </h2>
              <p className="uppercase">
                TO THE FULLEST EXTENT PERMITTED BY LAW, HYPERCLI SHALL NOT BE
                LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR
                PUNITIVE DAMAGES, INCLUDING LOSS OF PROFITS, DATA, OR GOODWILL,
                ARISING OUT OF OR RELATED TO YOUR USE OF THE SERVICES, EVEN IF
                WE HAVE BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.
              </p>
              <p className="mt-4 uppercase">
                OUR TOTAL LIABILITY FOR ANY CLAIMS ARISING OUT OF OR RELATED TO
                THIS AGREEMENT OR THE SERVICES SHALL NOT EXCEED THE AMOUNT YOU
                PAID US IN THE TWELVE (12) MONTHS PRECEDING THE CLAIM.
              </p>
              <p className="mt-4">
                Some jurisdictions do not allow the exclusion or limitation of
                certain damages, so the above limitations may not apply to you.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">
                12. Indemnification
              </h2>
              <p>
                You agree to indemnify, defend, and hold harmless HyperCLI and
                its officers, directors, employees, and agents from and against
                any claims, damages, losses, liabilities, and expenses (including
                reasonable attorneys&apos; fees) arising out of or related to:
              </p>
              <ul className="list-disc list-inside mt-4 space-y-2">
                <li>Your use of the Services</li>
                <li>Your User Content</li>
                <li>Your violation of this Agreement</li>
                <li>Your violation of any third-party rights</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">
                13. Governing Law
              </h2>
              <p>
                This Agreement shall be governed by and construed in accordance
                with the laws of the State of Delaware, United States, without
                regard to its conflict of law provisions.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">
                14. Changes to This Agreement
              </h2>
              <p>
                We may modify this Agreement at any time by posting the revised
                terms on our website. Material changes will be communicated via
                email or a prominent notice on the Services. Your continued use
                of the Services after changes become effective constitutes
                acceptance of the revised Agreement.
              </p>
              <p className="mt-4">
                If you do not agree to the revised terms, you must stop using
                the Services.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">
                15. General Provisions
              </h2>
              <p>
                <strong className="text-foreground">Entire Agreement:</strong> This
                Agreement, together with our Privacy Policy, constitutes the entire
                agreement between you and HyperCLI regarding the Services.
              </p>
              <p className="mt-4">
                <strong className="text-foreground">Severability:</strong> If any
                provision of this Agreement is found to be unenforceable, the
                remaining provisions will continue in effect.
              </p>
              <p className="mt-4">
                <strong className="text-foreground">Waiver:</strong> Our failure to
                enforce any provision of this Agreement shall not constitute a
                waiver of that provision.
              </p>
              <p className="mt-4">
                <strong className="text-foreground">Assignment:</strong> You may not
                assign this Agreement without our prior written consent. We may
                assign this Agreement at any time.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">
                16. Contact Us
              </h2>
              <p>
                If you have any questions about this Agreement, please contact
                us at{" "}
                <a
                  href="mailto:support@hypercli.com"
                  className="text-primary hover:underline"
                >
                  support@hypercli.com
                </a>
                .
              </p>
            </section>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
