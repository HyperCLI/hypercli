// Mobile viewport height handler with keyboard offset for sticky composer
export function initViewportHeight() {
  if (typeof window === 'undefined') return;

  const update = () => {
    // Visual Viewport is the "visible" area not covered by keyboard/address bar
    const vv = window.visualViewport;
    if (!vv) {
      // Fallback for browsers without Visual Viewport API
      const vh = window.innerHeight;
      document.documentElement.style.setProperty('--app-height', `${vh}px`);
      document.documentElement.style.setProperty('--keyboard-offset', '0px');
      return;
    }

    // Set app height using visual viewport
    document.documentElement.style.setProperty('--app-height', `${vv.height}px`);

    // Calculate how much the visual viewport bottom is above the layout viewport bottom
    // When keyboard opens, vv.height shrinks, and this becomes positive
    const offset = Math.max(0, window.innerHeight - (vv.height + vv.offsetTop));
    
    // Set the keyboard offset as a CSS variable
    document.documentElement.style.setProperty('--keyboard-offset', `${offset}px`);
  };

  // Set on load
  update();

  // Visual Viewport API listeners (handles keyboard show/hide)
  const vv = window.visualViewport;
  if (vv) {
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update); // handles iOS toolbar changes
  }

  // Fallback resize listener
  window.addEventListener('resize', update);

  // Handle orientation change
  window.addEventListener('orientationchange', () => {
    setTimeout(update, 100);
  });

  // iOS Safari specific: update when scrolling
  let scrollTimer: NodeJS.Timeout;
  window.addEventListener('scroll', () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(update, 100);
  }, { passive: true });
}
