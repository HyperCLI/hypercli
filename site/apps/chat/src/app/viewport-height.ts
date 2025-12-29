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

  const setKeyboardHeight = () => {
    // Use Visual Viewport API to detect keyboard
    if (window.visualViewport) {
      const viewportHeight = window.visualViewport.height;
      const windowHeight = window.innerHeight;
      
      // Keyboard height is the difference between window height and viewport height
      const keyboardHeight = windowHeight - viewportHeight;
      
      // Set custom property for keyboard offset
      document.documentElement.style.setProperty('--keyboard-height', `${keyboardHeight}px`);
      
      // Also update the app height to use visual viewport
      document.documentElement.style.setProperty('--app-height', `${viewportHeight}px`);
    }
  };

  // Set on load
  setViewportHeight();
  setKeyboardHeight();

  // Update on resize (when keyboard shows/hides or orientation changes)
  let resizeTimer: NodeJS.Timeout;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      setViewportHeight();
      setKeyboardHeight();
    }, 100);
  });

  // Handle orientation change separately for better mobile support
  window.addEventListener('orientationchange', () => {
    setTimeout(() => {
      setViewportHeight();
      setKeyboardHeight();
    }, 100);
  });

  // Visual Viewport API for keyboard handling (best for mobile)
  if (window.visualViewport) {
    // This fires when keyboard shows/hides
    window.visualViewport.addEventListener('resize', setKeyboardHeight);
    window.visualViewport.addEventListener('scroll', setKeyboardHeight);
  }

  // iOS Safari specific: update when scrolling starts (keyboard dismiss)
  let scrollTimer: NodeJS.Timeout;
  window.addEventListener('scroll', () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      setViewportHeight();
      setKeyboardHeight();
    }, 100);
  }, { passive: true });
}
