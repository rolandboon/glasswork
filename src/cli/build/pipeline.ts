import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import consola from 'consola';
import { analyzeMetafile, build as esbuild, type Metafile } from 'esbuild';
import mjml2html from 'mjml';
import { type CompileResult, compileTemplates } from '../../email/compiler/compile-templates.js';
import type { BuildHooks, ResolvedGlassworkCliConfig, ResolvedJobsConfig } from '../config.js';
import { generateSamTemplate } from '../generators/sam.js';

export interface BundleSummary {
  outfile: string;
  metafile?: Metafile;
  duration: number;
}

export interface BuildSummary {
  duration: number;
  templates?: CompileResult | null;
  bundle: BundleSummary;
  workerBundle?: BundleSummary | null;
  samTemplate?: string | null;
  analysis?: string;
}

export interface BuildPipelineOptions {
  analyze?: boolean;
}

export class BuildPipeline {
  private readonly logger = consola.withTag('glasswork');

  constructor(private readonly config: ResolvedGlassworkCliConfig) {}

  async run(options: BuildPipelineOptions = {}): Promise<BuildSummary> {
    const start = Date.now();
    await this.runHook('build:before');

    const templates = await this.compileTemplates();
    const bundle = await this.bundle(options.analyze);
    const workerBundle = await this.bundleWorker(options.analyze);
    const samTemplate = await this.generateInfrastructure();

    const duration = Date.now() - start;
    await this.runHook('build:after', duration);

    const analysis =
      options.analyze && bundle.metafile ? await analyzeMetafile(bundle.metafile) : undefined;

    return {
      duration,
      templates,
      bundle,
      workerBundle,
      samTemplate,
      analysis,
    };
  }

  async compileTemplates(): Promise<CompileResult | null> {
    const templatesConfig = this.config.email?.templates;
    if (!templatesConfig) return null;

    this.logger.info('📧 Compiling email templates...');
    const result = compileTemplates({
      ...templatesConfig,
      mjmlCompile: (source) => mjml2html(source, { validationLevel: 'soft' }),
    });
    this.logger.success(`Compiled ${result.count} template(s)`);
    return result;
  }

  async bundle(analyze?: boolean): Promise<BundleSummary> {
    this.logger.info('📦 Bundling API entrypoint...');
    return this.bundleWithEsbuild(this.config.build.entrypoint, this.config.build.outFile, {
      minify: this.config.build.minify,
      sourcemap: this.config.build.sourcemap,
      target: this.config.build.target,
      external: this.config.build.external,
      outDir: this.config.build.outDir,
      analyze,
    });
  }

  async bundleWorker(analyze?: boolean): Promise<BundleSummary | null> {
    const jobsConfig = this.config.jobs;
    if (!jobsConfig?.workerEntrypoint) return null;

    this.logger.info('👷 Bundling worker entrypoint...');
    return this.bundleWithEsbuild(
      jobsConfig.workerEntrypoint,
      jobsConfig.workerOutFile,
      {
        minify: this.config.build.minify,
        sourcemap: this.config.build.sourcemap,
        target: this.config.build.target,
        external: this.config.build.external,
        outDir: this.config.build.outDir,
        analyze,
      },
      jobsConfig
    );
  }

  async generateInfrastructure(): Promise<string | null> {
    if (!this.config.infrastructure) return null;

    this.logger.info('🏗️  Generating infrastructure template...');
    const template = generateSamTemplate(this.config);
    const outputPath = this.config.infrastructure.samOutput;
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, template, 'utf8');
    this.logger.success(`Saved SAM template to ${outputPath}`);
    return template;
  }

  private async bundleWithEsbuild(
    entrypoint: string,
    outFile: string,
    options: {
      minify: boolean;
      sourcemap: boolean;
      target: string;
      external: string[];
      outDir: string;
      analyze?: boolean;
    },
    jobsConfig?: ResolvedJobsConfig
  ): Promise<BundleSummary> {
    mkdirSync(options.outDir, { recursive: true });

    const outfile = join(options.outDir, outFile);
    const start = Date.now();

    const result = await esbuild({
      entryPoints: [entrypoint],
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: options.target,
      minify: options.minify,
      sourcemap: options.sourcemap,
      outfile,
      external: options.external,
      metafile: options.analyze,
      logLevel: 'silent',
      define: jobsConfig?.workerEntrypoint ? { 'process.env.WORKER': '"true"' } : undefined,
    });

    const duration = Date.now() - start;
    this.logger.success(`Bundled ${outfile} in ${duration}ms`);

    return {
      outfile,
      metafile: result.metafile,
      duration,
    };
  }

  private async runHook(name: keyof BuildHooks, duration?: number) {
    const hook = this.config.hooks?.[name];
    if (!hook) return;

    await hook({
      config: this.config,
      duration,
    });
  }
}
