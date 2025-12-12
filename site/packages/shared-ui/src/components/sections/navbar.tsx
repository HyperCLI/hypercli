type Page = 'home' | 'partners' | 'enterprise' | 'datacenter';

interface NavbarProps {
  currentPage: Page;
  setCurrentPage: (page: Page) => void;
}

export function Navbar({ currentPage, setCurrentPage }: NavbarProps) {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-[#0B0D0E]/80 backdrop-blur-lg border-b border-[#2A2D2F]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo */}
          <div className="flex items-center">
            <button 
              onClick={() => setCurrentPage('home')}
              className="flex items-center gap-2 hover:opacity-80 transition-opacity"
            >
              <div className="w-8 h-8 bg-[#38D39F] rounded-md flex items-center justify-center">
                <span className="text-[#0B0D0E] text-lg font-semibold">H</span>
              </div>
              <span className="text-xl text-white font-semibold">HyperCLI</span>
            </button>
          </div>

          {/* Navigation Links */}
          <div className="hidden md:flex items-center gap-6">
            <button 
              onClick={() => setCurrentPage('partners')}
              className={`text-sm transition-colors ${
                currentPage === 'partners' ? 'text-[#38D39F]' : 'text-[#D4D6D7] hover:text-white'
              }`}
            >
              Partners
            </button>
            <button 
              onClick={() => setCurrentPage('enterprise')}
              className={`text-sm transition-colors ${
                currentPage === 'enterprise' ? 'text-[#38D39F]' : 'text-[#D4D6D7] hover:text-white'
              }`}
            >
              Enterprise
            </button>
            <button 
              onClick={() => setCurrentPage('datacenter')}
              className={`text-sm transition-colors ${
                currentPage === 'datacenter' ? 'text-[#38D39F]' : 'text-[#D4D6D7] hover:text-white'
              }`}
            >
              Data Centers
            </button>
          </div>

          {/* Right CTAs */}
          <div className="flex items-center gap-3">
            <button className="hidden sm:inline-flex px-4 py-2 text-sm text-[#D4D6D7] hover:text-white transition-colors">
              Login
            </button>
            <button className="px-5 py-2 text-sm bg-[#38D39F] text-[#0B0D0E] rounded-lg hover:bg-[#45E4AE] transition-colors">
              Get Started
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
