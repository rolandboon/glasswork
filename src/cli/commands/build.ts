import { defineCommand } from 'citty';
import consola from 'consola';
import { BuildPipeline } from '../build/pipeline.js';
import { loadCliConfig } from '../config.js';

export const buildCommand = defineCommand({
  meta: {
    name: 'build',
    description: 'Build for production',
  },
  args: {
    analyze: {
      type: 'boolean',
      description: 'Print esbuild bundle analysis',
      default: false,
    },
  },
  async run({ args }) {
    const config = await loadCliConfig();
    const pipeline = new BuildPipeline(config);

    const summary = await pipeline.run({ analyze: args.analyze });

    if (summary.analysis) {
      consola.box(summary.analysis);
    }

    consola.success(`Build completed in ${summary.duration}ms`);
  },
});
