# Glasswork Documentation

This directory contains the Vitepress documentation  for Glasswork.

## Development

Run the documentation site locally:

```bash
npm run docs:dev
```

This will start a local development server at `http://localhost:5173`.

## Building

Build the documentation for production:

```bash
npm run docs:build
```

The built site will be in `docs/.vitepress/dist`.

## Preview Production Build

Preview the production build locally:

```bash
npm run docs:preview
```

## Deployment

The documentation is automatically deployed to GitHub Pages when changes are pushed to the `main` branch.

The site is available at:
- Production: https://glasswork.dev
- GitHub Pages: https://rolandboon.github.io/glasswork

## Structure

- `docs/` - Root documentation directory
  - `.vitepress/` - Vitepress configuration
    - `config.ts` - Main configuration file
  - `public/` - Static assets (logo, CNAME, etc.)
  - `guide/` - Getting started and tutorials
  - `core-concepts/` - Architecture and philosophy
  - `api/` - API reference (TODO)

## Contributing

When adding new pages:
1. Create the `.md` file in the appropriate directory
2. Add it to the sidebar in `.vitepress/config.ts`
3. Test locally with `npm run docs:dev`
4. Remove `ignoreDeadLinks: true` from config once all pages are created
