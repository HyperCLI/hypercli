import type { Preview } from '@storybook/nextjs-vite';
import '../src/app/globals.css';

const preview: Preview = {
  globalTypes: {
    theme: {
      description: 'Product color theme',
      defaultValue: 'aurora-dark',
      toolbar: {
        icon: 'paintbrush',
        items: [
          { value: 'aurora-dark', title: 'Aurora Dark' },
          { value: 'aurora-light', title: 'Aurora Light' },
        ],
      },
    },
    planTier: {
      description: 'Account plan tier',
      defaultValue: 'solo',
      toolbar: {
        icon: 'bookmarkhollow',
        items: [
          { value: 'solo', title: 'Solo' },
          { value: 'team', title: 'Team' },
          { value: 'enterprise', title: 'Enterprise' },
        ],
      },
    },
  },
  decorators: [
    (Story, context) => {
      const supportedThemes = ['aurora-dark', 'aurora-light'] as const;
      const requestedTheme = String(context.globals.theme);
      const theme = supportedThemes.find((value) => value === requestedTheme) ?? 'aurora-dark';
      const mode = theme.endsWith('light') ? 'light' : 'dark';
      const tier = ['solo', 'team', 'enterprise'].includes(String(context.globals.planTier))
        ? String(context.globals.planTier)
        : 'solo';
      if (typeof document !== 'undefined') {
        document.documentElement.setAttribute('data-theme', theme);
        document.documentElement.setAttribute('data-color-mode', mode);
        document.documentElement.setAttribute('data-plan-tier', tier);
        document.documentElement.style.colorScheme = mode;
        document.body?.setAttribute('data-theme', theme);
        document.body?.setAttribute('data-color-mode', mode);
        document.body?.setAttribute('data-plan-tier', tier);
      }

      return Story();
    },
  ],
  parameters: {
    backgrounds: {
      default: 'dark',
      values: [
        { name: 'dark', value: '#0a0a0b' },
        { name: 'light', value: '#f7f8f4' },
        { name: 'surface', value: '#141416' },
        { name: 'aurora dark', value: '#10151f' },
        { name: 'aurora light', value: '#ffffff' },
      ],
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
};

export default preview;
