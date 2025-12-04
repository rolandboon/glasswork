import { defineCommand } from 'citty';
import consola from 'consola';
import { loadCliConfig } from '../config.js';
import { runDevServer } from '../dev/server.js';

export const devCommand = defineCommand({
  meta: {
    name: 'dev',
    description: 'Start development server with watch mode',
  },
  args: {
    port: {
      type: 'string',
      description: 'Port to run dev server on',
      default: '3000',
    },
    lambda: {
      type: 'boolean',
      description: 'Use SAM Local style environment',
      default: false,
    },
  },
  async run({ args }) {
    const config = await loadCliConfig();
    const port = Number.parseInt(args.port, 10);

    if (Number.isNaN(port)) {
      throw new Error(`Invalid port: ${args.port}`);
    }

    await runDevServer(config, {
      port,
      lambda: Boolean(args.lambda),
    });

    consola.info(`Dev server running on port ${port} (lambda mode: ${Boolean(args.lambda)})`);
  },
});
