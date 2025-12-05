import { defineConfig } from 'vitepress';
import { withMermaid } from 'vitepress-plugin-mermaid';

// Shared sidebar configuration for all documentation pages
const docsSidebar = [
  {
    text: 'Getting Started',
    collapsed: false, // Keep open for onboarding
    items: [
      { text: 'What is Glasswork?', link: '/getting-started/what-is-glasswork' },
      { text: 'Quick Start', link: '/getting-started/quick-start' },
    ],
  },
  {
    text: 'Application Structure',
    collapsed: true,
    items: [
      { text: 'Modules', link: '/application-structure/modules' },
      { text: 'Dependency Injection', link: '/application-structure/dependency-injection' },
      { text: 'Testing', link: '/application-structure/testing' },
    ],
  },
  {
    text: 'Request Handling',
    collapsed: true,
    items: [
      { text: 'Routes & Validation', link: '/request-handling/routes' },
      { text: 'Middleware', link: '/request-handling/middleware' },
      { text: 'Error Handling', link: '/request-handling/error-handling' },
      { text: 'OpenAPI', link: '/request-handling/openapi' },
      { text: 'List Query', link: '/request-handling/list-query' },
    ],
  },
  {
    text: 'Configuration',
    collapsed: true,
    items: [
      { text: 'Bootstrap Options', link: '/configuration/bootstrap' },
      { text: 'Environment Config', link: '/configuration/environment-config' },
    ],
  },
  {
    text: 'Observability',
    collapsed: true,
    items: [
      { text: 'Overview', link: '/observability/overview' },
      { text: 'Logging', link: '/observability/logging' },
      { text: 'Exception Tracking', link: '/observability/exception-tracking' },
      { text: 'AppSignal Integration', link: '/observability/appsignal-integration' },
      { text: 'CloudWatch Insights', link: '/observability/cloudwatch-insights' },
      {
        text: 'CloudWatch Application Signals',
        link: '/observability/cloudwatch-application-signals',
      },
    ],
  },
  {
    text: 'Email',
    collapsed: true,
    items: [
      { text: 'Getting Started', link: '/email/getting-started' },
      { text: 'Templates', link: '/email/templates' },
      { text: 'Customization', link: '/email/customization' },
      { text: 'AWS Setup', link: '/email/aws-setup' },
      { text: 'API Reference', link: '/email/api' },
    ],
  },
  {
    text: 'Deployment',
    collapsed: true,
    items: [
      { text: 'Production Readiness', link: '/deployment/production-readiness' },
      { text: 'Lambda Deployment', link: '/deployment/lambda' },
    ],
  },
  {
    text: 'Architecture',
    collapsed: true,
    items: [
      { text: 'Transparency Principle', link: '/architecture/transparency' },
      { text: 'Philosophy', link: '/architecture/philosophy' },
    ],
  },
];

export default withMermaid(
  defineConfig({
    title: 'Glasswork',
    description:
      'A transparent, serverless-optimized web framework for building OpenAPI-compliant REST APIs.',

    base: '/',

    // Ignore localhost URLs in examples (they're not real links)
    ignoreDeadLinks: [/^http:\/\/localhost/],

    themeConfig: {
      logo: '/logo.png',

      nav: [
        { text: 'Guide', link: '/getting-started/quick-start' },
        { text: 'API', link: '/api/' },
        {
          text: 'v0.10.0',
          link: 'https://github.com/rolandboon/glasswork/releases',
        },
      ],

      sidebar: {
        '/api/': [
          {
            text: 'API Reference',
            items: [{ text: 'Overview', link: '/api/' }],
          },
        ],
        // Use shared sidebar for all documentation paths
        '/getting-started/': docsSidebar,
        '/application-structure/': docsSidebar,
        '/request-handling/': docsSidebar,
        '/configuration/': docsSidebar,
        '/observability/': docsSidebar,
        '/email/': docsSidebar,
        '/deployment/': docsSidebar,
        '/architecture/': docsSidebar,
      },

      socialLinks: [{ icon: 'github', link: 'https://github.com/rolandboon/glasswork' }],

      footer: {
        message: 'Released under the MIT License.',
        copyright: 'Copyright © 2025 Roland Boon',
      },

      search: {
        provider: 'local',
      },

      outline: {
        level: [2, 3], // Show h2 and h3 in "On this page"
      },

      editLink: {
        pattern: 'https://github.com/rolandboon/glasswork/edit/main/docs/:path',
        text: 'Edit this page on GitHub',
      },
    },

    head: [
      ['link', { rel: 'icon', type: 'image/png', href: '/logo.png' }],
      ['meta', { name: 'theme-color', content: '#646cff' }],
      ['meta', { property: 'og:type', content: 'website' }],
      ['meta', { property: 'og:title', content: 'Glasswork' }],
      [
        'meta',
        {
          property: 'og:description',
          content: 'A transparent, serverless-optimized web framework',
        },
      ],
    ],
  })
);
