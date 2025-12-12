import { Github, Twitter, Linkedin } from 'lucide-react';

type Page = 'home' | 'partners' | 'enterprise' | 'datacenter';

interface FooterProps {
  currentPage: Page;
  setCurrentPage: (page: Page) => void;
}

export function Footer({ currentPage, setCurrentPage }: FooterProps) {
  const footerLinks = {
    Product: [
      { label: 'Docs', href: '#' },
      { label: 'API Reference', href: '#' },
      { label: 'Templates', href: '#' },
      { label: 'Pricing', href: '#' }
    ],
    Solutions: [
      { label: 'Partners', page: 'partners' as Page },
      { label: 'Data Centers', page: 'datacenter' as Page },
      { label: 'Enterprise', page: 'enterprise' as Page }
    ],
    Account: [
      { label: 'Login', href: '#' },
      { label: 'Get Started', href: '#' }
    ]
  };

  return (
    <footer className="border-t border-[#2A2D2F] bg-[#0B0D0E]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-8 mb-12">
          {/* Brand column */}
          <div className="col-span-2">
            <button 
              onClick={() => setCurrentPage('home')}
              className="flex items-center gap-2 mb-4 hover:opacity-80 transition-opacity"
            >
              <div className="w-8 h-8 bg-[#38D39F] rounded-md flex items-center justify-center">
                <span className="text-[#0B0D0E] text-lg font-semibold">H</span>
              </div>
              <span className="text-xl text-white font-semibold">HyperCLI</span>
            </button>
            <p className="text-[#9BA0A2] text-sm mb-6 max-w-xs">
              Developer-first AI infrastructure. Deploy models in one command, scale to millions of requests.
            </p>
            
            {/* Social links */}
            <div className="flex items-center gap-4">
              <a href="#" className="w-9 h-9 rounded-lg bg-[#161819] hover:bg-[#1D1F21] flex items-center justify-center transition-colors">
                <Github className="w-4 h-4 text-[#9BA0A2]" />
              </a>
              <a href="#" className="w-9 h-9 rounded-lg bg-[#161819] hover:bg-[#1D1F21] flex items-center justify-center transition-colors">
                <Twitter className="w-4 h-4 text-[#9BA0A2]" />
              </a>
              <a href="#" className="w-9 h-9 rounded-lg bg-[#161819] hover:bg-[#1D1F21] flex items-center justify-center transition-colors">
                <Linkedin className="w-4 h-4 text-[#9BA0A2]" />
              </a>
            </div>
          </div>

          {/* Link columns */}
          {Object.entries(footerLinks).map(([category, links]) => (
            <div key={category}>
              <h3 className="text-white mb-4">{category}</h3>
              <ul className="space-y-3">
                {links.map((link) => (
                  <li key={link.label}>
                    {'page' in link ? (
                      <button 
                        onClick={() => setCurrentPage(link.page)}
                        className="text-sm text-[#9BA0A2] hover:text-white transition-colors"
                      >
                        {link.label}
                      </button>
                    ) : (
                      <a href={link.href} className="text-sm text-[#9BA0A2] hover:text-white transition-colors">
                        {link.label}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="pt-8 border-t border-[#2A2D2F] flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-sm text-[#6E7375]">
            © 2025 HyperCLI. All rights reserved.
          </p>
          <div className="flex items-center gap-6">
            <a href="#" className="text-sm text-[#6E7375] hover:text-[#9BA0A2] transition-colors">
              Privacy Policy
            </a>
            <a href="#" className="text-sm text-[#6E7375] hover:text-[#9BA0A2] transition-colors">
              Terms of Service
            </a>
            <a href="#" className="text-sm text-[#6E7375] hover:text-[#9BA0A2] transition-colors">
              Cookie Settings
            </a>
          </div>
        </div>

        {/* Login link for mobile */}
        <div className="mt-8 pt-8 border-t border-[#2A2D2F] md:hidden text-center">
          <a href="#" className="text-[#9BA0A2] hover:text-white transition-colors">
            Login →
          </a>
        </div>
      </div>
    </footer>
  );
}