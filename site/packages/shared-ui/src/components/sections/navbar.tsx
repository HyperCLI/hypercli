type Page = 'home' | 'partners' | 'enterprise' | 'datacenter';

interface NavbarProps {
  currentPage: Page;
  setCurrentPage: (page: Page) => void;
}

export function Navbar({ currentPage, setCurrentPage }: NavbarProps) {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-lg border-b border-border-medium">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo */}
          <div className="flex items-center">
            <button 
              onClick={() => setCurrentPage('home')}
              className="flex items-center gap-2 hover:opacity-80 transition-opacity cursor-pointer"
            >
              <div className="w-8 h-8 bg-primary rounded-md flex items-center justify-center">
                <span className="text-primary-foreground text-lg font-semibold">H</span>
              </div>
              <span className="text-xl text-foreground font-semibold">HyperCLI</span>
            </button>
          </div>

          {/* Navigation Links */}
          <div className="hidden md:flex items-center gap-6">
            <button 
              onClick={() => setCurrentPage('partners')}
              className={`text-sm transition-colors cursor-pointer ${
                currentPage === 'partners' ? 'text-primary' : 'text-secondary-foreground hover:text-foreground'
              }`}
            >
              Partners
            </button>
            <button 
              onClick={() => setCurrentPage('enterprise')}
              className={`text-sm transition-colors cursor-pointer ${
                currentPage === 'enterprise' ? 'text-primary' : 'text-secondary-foreground hover:text-foreground'
              }`}
            >
              Enterprise
            </button>
            <button 
              onClick={() => setCurrentPage('datacenter')}
              className={`text-sm transition-colors cursor-pointer ${
                currentPage === 'datacenter' ? 'text-primary' : 'text-secondary-foreground hover:text-foreground'
              }`}
            >
              Data Centers
            </button>
          </div>

          {/* Right CTAs */}
          <div className="flex items-center gap-3">
            <button className="hidden sm:inline-flex px-4 py-2 text-sm text-secondary-foreground hover:text-foreground transition-colors cursor-pointer">
              Login
            </button>
            <button className="px-5 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover transition-colors cursor-pointer">
              Get Started
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
