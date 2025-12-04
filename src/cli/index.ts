import { defineCommand, runMain } from 'citty';
import { buildCommand } from './commands/build.js';
import { devCommand } from './commands/dev.js';
import { generateCommand } from './commands/generate.js';

export const cli = defineCommand({
  meta: {
    name: 'glasswork',
    description: 'Glasswork CLI',
  },
  subCommands: {
    build: buildCommand,
    dev: devCommand,
    generate: generateCommand,
  },
});

export function runCli(argv = process.argv.slice(2)) {
  return runMain(cli, { argv });
}
