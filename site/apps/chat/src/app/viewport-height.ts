// Mobile viewport height handler
// Sets CSS custom property for mobile browsers that don't support dvh
export function initViewportHeight() {
  if (typeof window === 'undefined') return;

  const setViewportHeight = () => {
    // Get the actual viewport height
    const vh = window.innerHeight;
    // Set the custom property
    document.documentElement.style.setProperty('--app-height', `${vh}px`);
  };

  // Set on load
  setViewportHeight();

  // Update on resize (when keyboard shows/hides or orientation changes)
  let resizeTimer: NodeJS.Timeout;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(setViewportHeight, 100);
  });

  // Handle orientation change separately for better mobile support
  window.addEventListener('orientationchange', () => {
    setTimeout(setViewportHeight, 100);
  });

  // iOS Safari specific: update when scrolling starts (keyboard dismiss)
  let scrollTimer: NodeJS.Timeout;
  window.addEventListener('scroll', () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(setViewportHeight, 100);
  }, { passive: true });

  // Visual viewport API for better mobile keyboard handling (if supported)
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', setViewportHeight);
  }
}
