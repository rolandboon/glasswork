import { defineConfig } from 'vitepress';
import { withMermaid } from 'vitepress-plugin-mermaid';

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
        { text: 'Guide', link: '/guide/getting-started' },
        { text: 'API', link: '/api/' },
        {
          text: 'v0.9.2',
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

        '/guide/': [
          {
            text: 'Introduction',
            items: [
              { text: 'What is Glasswork?', link: '/guide/what-is-glasswork' },
              { text: 'Getting Started', link: '/guide/getting-started' },
            ],
          },
          {
            text: 'Basics',
            items: [
              { text: 'Modules', link: '/guide/modules' },
              { text: 'Routes & Validation', link: '/guide/routes' },
              { text: 'Middleware', link: '/guide/middleware' },
              { text: 'Dependency Injection', link: '/guide/dependency-injection' },
              { text: 'Configuration', link: '/guide/configuration' },
              { text: 'Error Handling', link: '/guide/error-handling' },
              { text: 'OpenAPI', link: '/guide/openapi' },
            ],
          },
          {
            text: 'Advanced',
            items: [
              { text: 'List Query', link: '/guide/list-query' },
              { text: 'Lambda Deployment', link: '/guide/lambda' },
              { text: 'Testing', link: '/guide/testing' },
            ],
          },
          {
            text: 'Core Concepts',
            items: [
              { text: 'Transparency Principle', link: '/core-concepts/transparency' },
              { text: 'Architecture Philosophy', link: '/core-concepts/philosophy' },
            ],
          },
        ],

        '/core-concepts/': [
          {
            text: 'Introduction',
            items: [
              { text: 'What is Glasswork?', link: '/guide/what-is-glasswork' },
              { text: 'Getting Started', link: '/guide/getting-started' },
            ],
          },
          {
            text: 'Basics',
            items: [
              { text: 'Modules', link: '/guide/modules' },
              { text: 'Routes & Validation', link: '/guide/routes' },
              { text: 'Middleware', link: '/guide/middleware' },
              { text: 'Dependency Injection', link: '/guide/dependency-injection' },
              { text: 'Configuration', link: '/guide/configuration' },
              { text: 'Error Handling', link: '/guide/error-handling' },
              { text: 'OpenAPI', link: '/guide/openapi' },
            ],
          },
          {
            text: 'Advanced',
            items: [
              { text: 'List Query', link: '/guide/list-query' },
              { text: 'Lambda Deployment', link: '/guide/lambda' },
              { text: 'Testing', link: '/guide/testing' },
            ],
          },
          {
            text: 'Core Concepts',
            items: [
              { text: 'Transparency Principle', link: '/core-concepts/transparency' },
              { text: 'Architecture Philosophy', link: '/core-concepts/philosophy' },
            ],
          },
        ],
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
