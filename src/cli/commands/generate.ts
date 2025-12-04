import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { defineCommand } from 'citty';
import consola from 'consola';
import { loadCliConfig } from '../config.js';
import { generateSamTemplate } from '../generators/sam.js';

const generateSamCommand = defineCommand({
  meta: {
    name: 'sam',
    description: 'Generate AWS SAM template from glasswork.config',
  },
  args: {
    output: {
      type: 'string',
      description: 'Where to write the SAM template',
      default: 'template.yaml',
    },
  },
  async run({ args }) {
    const config = await loadCliConfig();
    const template = generateSamTemplate(config);
    const outputPath = resolve(config.rootDir, args.output);

    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, template, 'utf8');

    consola.success(`Generated SAM template at ${outputPath}`);
  },
});

export const generateCommand = defineCommand({
  meta: {
    name: 'generate',
    description: 'Generate deployment artifacts',
  },
  subCommands: {
    sam: generateSamCommand,
  },
});
