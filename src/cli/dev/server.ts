import { type ChildProcess, spawn } from 'node:child_process';
import type { FSWatcher } from 'chokidar';
import chokidar from 'chokidar';
import consola from 'consola';
import { BuildPipeline } from '../build/pipeline.js';
import type { ResolvedGlassworkCliConfig } from '../config.js';

export interface DevServerHandle {
  close(): void;
  process: ChildProcess;
  watchers: FSWatcher[];
}

export interface DevServerOptions {
  port?: number;
  lambda?: boolean;
}

export async function runDevServer(
  config: ResolvedGlassworkCliConfig,
  options: DevServerOptions = {}
): Promise<DevServerHandle> {
  const logger = consola.withTag('glasswork');
  const pipeline = new BuildPipeline(config);

  if (config.email?.templates) {
    await pipeline.compileTemplates();
  }

  const watchers: FSWatcher[] = [];

  if (config.email?.templates) {
    const watcher = chokidar.watch(config.email.templates.sourceDir, {
      ignoreInitial: true,
    });

    watcher.on('all', async () => {
      logger.info('Detected template change, recompiling...');
      await pipeline.compileTemplates();
    });

    watchers.push(watcher);
  }

  const env = {
    ...process.env,
    PORT: String(options.port ?? 3000),
    GLASSWORK_LAMBDA_MODE: options.lambda ? 'true' : 'false',
  };

  const processHandle = spawn('tsx', ['watch', config.build.entrypoint], {
    stdio: 'inherit',
    env,
  });

  return {
    process: processHandle,
    watchers,
    close: () => {
      for (const watcher of watchers) {
        watcher.close();
      }

      if (!processHandle.killed) {
        processHandle.kill('SIGINT');
      }
    },
  };
}
