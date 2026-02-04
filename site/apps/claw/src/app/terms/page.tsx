import { Metadata } from "next";
import { ClawHeader } from "@/components/landing/ClawHeader";
import { ClawFooter } from "@/components/landing/ClawFooter";

export const metadata: Metadata = {
  title: "Terms & Conditions - HyperClaw",
  description: "HyperClaw Terms and Conditions of Service",
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background">
      <ClawHeader />
      <main className="pt-24 pb-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <h1 className="text-4xl font-bold text-foreground mb-4">
            Terms &amp; Conditions
          </h1>
          <p className="text-text-muted mb-8">Last Updated: February 4, 2025</p>

          <div className="prose prose-invert max-w-none space-y-8 text-text-secondary leading-relaxed">
            <section>
              <p>
                These Terms &amp; Conditions (this &quot;Agreement&quot;) apply to your access
                and/or use of the HyperClaw API platform, websites, mobile sites,
                applications, dashboards, and developer tools (collectively, the
                &quot;Sites&quot;) and the API services, inference endpoints, subscription
                plans, documentation, developer resources, and related services
                (collectively the &quot;Services&quot;). &quot;We&quot;, &quot;HyperClaw&quot;, &quot;HyperCLI&quot;, and
                &quot;Us&quot; mean HyperCLI, the company providing the Services to you.
                The terms &quot;User&quot; and &quot;you&quot; mean any user of the Services, whether
                individual developer, company, organization, or affiliate.
              </p>
              <p className="mt-4">
                For clarity, these Terms and Conditions apply to your access and/or
                use of the Services, whether through our API endpoints, web dashboard,
                command-line interface, SDK, or any other method. If you do not agree
                to these terms or any future updated version of them then you must NOT
                use, and must cease all use of any of Our Services. If any future
                update to these terms require a click to accept, then you may not be
                able to continue to use the Services until you have clicked to accept
                the updated terms.
              </p>
              <p className="mt-4">
                These terms represent a legal agreement between You and HyperCLI.
                NOTICE: This Agreement may be subject to binding arbitration and a
                waiver of class action rights as detailed herein.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">
                Access and Use
              </h2>
              <p>
                By accessing or using the Services or by clicking &quot;accept&quot; or &quot;agree&quot;
                to this Agreement, (1) you acknowledge that you have read, understand,
                and agree to be bound by this Agreement, and (2) you represent and
                warrant that you are of legal age and not prohibited by law from
                accessing or using the Services. HyperClaw may update or revise this
                Agreement from time to time. You agree that you will review this
                Agreement periodically. You are free to decide whether or not to accept
                a modified version of this Agreement, but accepting this Agreement, as
                modified, is required for you to continue using the Services. If you do
                not agree to the terms of this Agreement or any modified version of
                this Agreement, you must terminate your use of the Services, in which
                case you will no longer have access to your Account.
              </p>
              <p className="mt-4">
                You agree that you are at least 18 years of age. If you are using the
                Services on behalf of an organization, you represent and warrant that
                you have the authority to bind that organization to this Agreement.
              </p>
              <p className="mt-4">
                We reserve the right to make changes to these Terms and Conditions at
                any time in accordance with those Terms herein. Your continued use of
                our Services after the Terms and Conditions have been updated shall
                confirm your acceptance of the updated Terms and Conditions.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">
                Account
              </h2>
              <p>
                Your account with HyperClaw, as created through the Sites (&quot;Account&quot;),
                and via use of a login feature or authentication provider, in order to
                use the Services, is your account but this information is Personal
                Information for the purposes of data protection. Please see our Privacy
                Policy for information about how your Personal Information is used.
                When registering for an Account, you must provide true, accurate,
                current, and complete data about yourself. You also agree to promptly
                update your information for completeness and accuracy. You are solely
                responsible for maintaining the confidentiality of your Account, API
                keys, and the information in your Account, and, except as otherwise
                required by applicable law, you are solely responsible for all use of
                your Account and API keys, whether or not authorized by you. You agree
                to immediately notify HyperClaw of any unauthorized use of your Account
                or API keys or any other breach of security related to your use of the
                Services.
              </p>
              <p className="mt-4">
                You acknowledge and agree that API keys are confidential credentials.
                Any sharing of API keys outside your organization or beyond authorized
                users constitutes a breach of this Agreement. You agree and acknowledge
                that you will not abuse the Services by allowing access to additional
                individuals or systems beyond what is permitted by your subscription
                plan.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">
                Communications
              </h2>
              <p>
                By using our Sites and Services, You agree that HyperClaw may
                communicate with you via electronic messages, including email, in
                accordance with our Privacy Policy. You are responsible for all data
                charges resulting from your use of the Services.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">
                Updates to Terms and Conditions &amp; Services
              </h2>
              <p>
                HyperClaw reserves the right to modify these Terms and Conditions from
                time to time and without notice, including, without limitation, by
                removing, adding, or modifying portions of the Sites and/or Services.
                If you object to any such changes, your sole recourse shall be to cease
                using the Services. Continued use of the Services following any such
                changes shall indicate your acknowledgment of such changes and
                satisfaction with any and all changes to the Terms and Conditions.
              </p>
              <p className="mt-4">
                HyperClaw reserves the right to modify the Services being provided from
                time to time and without notice, including, without limitation, by
                modifying API endpoints, rate limits, available models, features, and
                pricing. If you object to any such changes, your sole recourse shall be
                to cease using the Services. Continued use of the Services following
                any such changes shall indicate your acknowledgment of such changes.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">
                Intellectual Property
              </h2>
              <p>
                The features, information, and materials provided through the Services
                are protected by copyright, trademark, patent, and other intellectual
                property laws. All documentation, API specifications, SDK code,
                graphical content, and other content made available through the
                Services (collectively, the &quot;HyperClaw Content&quot;) are provided to the
                User by HyperClaw, or its partners or licensees solely to support
                User&apos;s permitted use of the Services. The HyperClaw Content may be
                modified from time to time by HyperClaw in its sole discretion.
              </p>
              <p className="mt-4">
                Except as expressly set forth herein, no license is granted to User for
                any other purpose, and any other use of the Services or the HyperClaw
                Content by User shall constitute a material breach of this Agreement.
                HyperClaw and its partners or licensees retain all rights in the
                Services and HyperClaw Content and any associated patents, trademarks,
                copyrights, trade secrets, or other intellectual property rights. No
                license, right, or interest in any trademarks of HyperClaw or any third
                party is granted under this Agreement.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">
                Acceptable Use &amp; Restrictions
              </h2>
              <p>
                The Services are offered solely for the User&apos;s use for the purposes
                described in this Agreement. Any and all other uses are prohibited.
                HyperClaw expressly reserves all its rights and remedies under
                applicable laws. You agree not to use the Services to:
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
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">
                Termination
              </h2>
              <p>
                HyperClaw reserves the right, in its sole discretion, to refuse service,
                terminate Accounts, revoke API keys, or deny access to the Services.
                HyperClaw may suspend your ability to use all or any element of the
                Services or may terminate this Agreement effective immediately, without
                notice or explanation. Without limiting the foregoing, HyperClaw may
                suspend your access to the Services if We believe you to be in violation
                of any part of this Agreement. After any suspension or termination, You
                may or may not be granted permission to use the Services or re-establish
                an Account. You agree that HyperClaw shall not be liable to you for any
                termination of this Agreement or for any effects of any termination of
                this Agreement.
              </p>
              <p className="mt-4">
                You may cancel your subscription at any time through your Account
                dashboard. Upon cancellation, your access will continue until the end
                of your current billing period. HyperClaw reserves the right to refuse
                Services to anyone, for any reason. In the event that Services are
                refused for a particular registration, participants will be refunded
                the prorated amount, so long as the Services are not refused for a
                violation of this or any other Agreement.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">
                User Content
              </h2>
              <p>
                During use of the Services you may submit prompts, data, and other
                content through the API (&quot;User Content&quot;). You retain ownership of
                your User Content. By submitting User Content, you grant HyperClaw
                a limited license to process such content solely to provide the
                Services to you.
              </p>
              <p className="mt-4">
                You are responsible for ensuring that your User Content complies with
                applicable laws and does not infringe on the rights of third parties.
                You represent that you own or have obtained the necessary rights and
                permissions to use and submit your User Content.
              </p>
              <p className="mt-4">
                HyperClaw does not monitor or review User Content and assumes no
                liability for content submitted by users. As described in our Privacy
                Policy, we do not store User Content beyond what is necessary to
                process your API requests in real-time.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">
                Representations and Warranties
              </h2>
              <p>
                You represent and warrant that You own or otherwise control all of the
                rights to any User Content submitted by You and/or your affiliates;
                that all User Content submitted by you is lawful; and that exploitation
                of such User Content by HyperClaw will not violate this Agreement,
                cause injury to any person or entity, or infringe any third-party rights
                (including, without limitation, intellectual property rights and rights
                of privacy). You will indemnify, hold harmless, and (at HyperClaw&apos;s
                request) defend HyperClaw, its affiliates, and its and their
                representatives, agents, directors, managers, officers, employees, and
                shareholders (collectively, the &quot;HyperClaw Parties&quot;) from and against
                all claims resulting from (1) any User Content submitted by you, (2)
                your use of the Services, or (3) any breach or alleged breach by you of
                this Agreement.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">
                Limitation of Liability
              </h2>
              <p className="uppercase">
                EXCEPT AS EXPRESSLY SPECIFIED HEREIN, IN NO EVENT SHALL HYPERCLAW BE
                LIABLE FOR ANY INJURIES, LOSSES, CLAIMS, OR DIRECT DAMAGES OR ANY
                SPECIAL, EXEMPLARY, PUNITIVE, INCIDENTAL, OR CONSEQUENTIAL DAMAGES OF
                ANY KIND, WHETHER BASED IN CONTRACT, TORT, OR OTHERWISE, AND EVEN IF
                ADVISED OF THE POSSIBILITY OF SUCH DAMAGES, WHICH ARISE OUT OF OR ARE
                ANY WAY CONNECTED WITH (1) THIS AGREEMENT (INCLUDING ANY CHANGES
                THERETO), (2) ANY USE OF THE HYPERCLAW SITES, SERVICES, THE HYPERCLAW
                CONTENT, OR THE USER CONTENT, (3) ANY FAILURE OR DELAY (INCLUDING, BUT
                NOT LIMITED TO, THE USE OR INABILITY TO USE ANY COMPONENT OF ANY OF THE
                SERVICES), OR (4) THE PERFORMANCE, NON-PERFORMANCE, CONDUCT, OR POLICIES
                OF ANY API ENDPOINTS OR INFERENCE SERVICES.
              </p>
              <p className="mt-4 uppercase">
                YOU UNDERSTAND THAT USE OF THE SERVICES IS AT YOUR OWN RISK AND
                HYPERCLAW CANNOT GUARANTEE THAT THE SERVICES WILL BE UNINTERRUPTED OR
                ERROR-FREE. THE SERVICES, ALL HYPERCLAW CONTENT, AND ANY OTHER
                INFORMATION, PRODUCTS, AND MATERIALS CONTAINED IN OR ACCESSED THROUGH
                THE SERVICES, ARE PROVIDED TO USER ON AN &quot;AS IS&quot; BASIS AND WITHOUT
                WARRANTY OF ANY KIND.
              </p>
              <p className="mt-4 uppercase">
                HYPERCLAW EXPRESSLY DISCLAIMS ALL REPRESENTATIONS, WARRANTIES,
                CONDITIONS, OR INDEMNITIES, EXPRESS OR IMPLIED, INCLUDING, WITHOUT
                LIMITATION, ANY WARRANTY OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
                PURPOSE, TITLE, OR NON-INFRINGEMENT, OR ANY WARRANTY ARISING FROM A
                COURSE OF DEALING, PERFORMANCE, OR TRADE USAGE.
              </p>
              <p className="mt-4 uppercase">
                HYPERCLAW DOES NOT WARRANT THAT YOUR USE OF THE SERVICES WILL BE
                UNINTERRUPTED OR ERROR-FREE, THAT THE API RESPONSES WILL BE ACCURATE,
                OR THAT IT WILL PRESERVE OR MAINTAIN ANY INFORMATION WITHOUT LOSS.
                LLM OUTPUTS MAY CONTAIN ERRORS, INACCURACIES, OR INAPPROPRIATE CONTENT.
                YOU ARE SOLELY RESPONSIBLE FOR EVALUATING AND USING ANY OUTPUT FROM
                THE SERVICES.
              </p>
              <p className="mt-4 uppercase">
                HYPERCLAW SHALL NOT BE LIABLE FOR DELAYS, INTERRUPTIONS, SERVICE
                FAILURES, OR OTHER PROBLEMS INHERENT IN USE OF THE INTERNET AND
                ELECTRONIC COMMUNICATIONS OR OTHER SYSTEMS OUTSIDE THE REASONABLE
                CONTROL OF HYPERCLAW.
              </p>
              <p className="mt-4 uppercase">
                IN NO EVENT SHALL OUR LIABILITY EXCEED THE ACTUAL PRICE PAID BY YOU
                (IF ANY) FOR THE SERVICES DURING THE TWELVE (12) MONTHS PRECEDING THE
                CLAIM. SOME JURISDICTIONS DO NOT ALLOW LIMITATIONS ON HOW LONG AN
                IMPLIED WARRANTY LASTS AND/OR THE EXCLUSION OR LIMITATION OF DAMAGES,
                SO THE ABOVE LIMITATIONS AND/OR EXCLUSIONS MAY NOT APPLY TO YOU.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">
                Third Parties
              </h2>
              <p>
                The Services may utilize third-party infrastructure, models, and
                services. HyperClaw assumes no liability whatsoever for any such
                third-party services or any content, features, products, or services
                made available through such third-party services. HyperClaw is unable
                to offer any guarantees, warranties, or the like with respect to
                third-party services and/or the handling of data by third parties.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">
                Severability
              </h2>
              <p>
                If any of the provisions, or portions thereof, of this Agreement are
                found to be invalid under any applicable statute or rule of law, then,
                that provision (or portion thereof) notwithstanding, this Agreement
                shall remain in full force and effect and such provision or portion
                thereof shall be deemed omitted.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">
                Assignment
              </h2>
              <p>
                This Agreement and the rights granted and obligations undertaken
                hereunder may not be transferred, assigned, or delegated in any manner
                by User, but may be freely transferred, assigned, or delegated by
                HyperClaw.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">
                Waiver
              </h2>
              <p>
                Any waiver of any provision of this Agreement, or a delay by any party
                in the enforcement of any right hereunder, shall neither be construed
                as a continuing waiver nor create an expectation of non-enforcement of
                that or any other provision or right.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">
                Purchases and Subscriptions
              </h2>
              <p>
                Purchasing any subscription, plan, or service made available by
                HyperClaw (&quot;Purchase&quot;), may require you to provide certain information
                relevant to your Purchase, including, but not limited to, payment
                information, billing address, and account information.
              </p>
              <p className="mt-4">
                When purchasing from HyperClaw, You represent and warrant that: (1) You
                have the legal right to make a Purchase and/or enter into an Agreement
                with HyperClaw for services in connection with any Purchase; and (2)
                that the information You provide is accurate and complete.
              </p>
              <p className="mt-4">
                Services of HyperClaw may employ the use of third-party services for
                the purpose of facilitating payment and the completion of transactions.
                By submitting your information, You grant Us the right to provide the
                information to any third parties necessary to process your payment,
                subject to Our Privacy Policy.
              </p>
              <p className="mt-4">
                We reserve the right to refuse and/or cancel your order at any time for
                reasons including, but not limited to: service availability, errors in
                the description or price of the service, errors in the order, or for
                any other reasons. Additionally, we reserve the right to refuse and/or
                cancel your order if fraud or unauthorized or illegal transaction or
                API abuse is suspected or the terms of this Agreement are violated in
                any way.
              </p>
              <p className="mt-4">
                You agree and acknowledge that each subscription plan provides access
                to the Services according to the specific rate limits and features
                described for that plan. You agree and acknowledge that subscription
                benefits are tied to your Account and may not be shared, transferred,
                or resold without authorization.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">
                Payment Terms
              </h2>
              <p>
                While we work hard to keep our service offerings updated to provide the
                most accurate information, We are frequently updating our products and
                service offerings. The services available may be mispriced, described
                inaccurately, or unavailable, and/or we may experience delays in
                updating information on the Services. You expressly agree that any such
                offer of a service does not constitute a legal offer capable of
                attracting legal consequences.
              </p>
              <p className="mt-4">
                We cannot and do not guarantee the accuracy or completeness of any
                information, including prices, specifications, availability, and/or
                services. We reserve the right to change or update information and to
                correct errors, inaccuracies, or omissions at any time without prior
                notice.
              </p>
              <p className="mt-4">
                If We do not receive payment from your payment provider or if your
                payment method expires or is rejected, you agree to pay all amounts due
                upon demand. You authorize us to charge outstanding fees and other
                amounts due to Us against any payment method you have on file with us.
                We reserve the right to take all steps necessary to collect amounts due
                from you, including but not limited to suspending your access to the
                Services and/or legal action.
              </p>
              <p className="mt-4">
                You are solely responsible for any and all fees charged by your payment
                provider. You agree to notify us about any billing problems or
                discrepancies within 90 days after they first appear on your statement.
                If you do not bring them to our attention within 90 days, you agree
                that you waive your right to dispute such problems or discrepancies.
                We may modify the price, content, or nature of the Services at any
                time. We will notify subscribers of any price changes prior to the
                implementation of any such change.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">
                Governing Law
              </h2>
              <p>
                This Agreement shall be governed by and construed in accordance with
                the laws of the State of Delaware, United States, without regard to its
                conflict of law provisions.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">
                Contact Us
              </h2>
              <p>
                If you have any questions about these Terms and Conditions, please
                contact us at{" "}
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
      <ClawFooter />
    </div>
  );
}
