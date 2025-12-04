import { dirname, resolve } from 'node:path';
import { loadConfig as loadC12Config } from 'c12';
import {
  array,
  type BaseSchema,
  boolean,
  number,
  object,
  optional,
  parse,
  record,
  string,
} from 'valibot';

export interface BuildConfig {
  entrypoint: string;
  outDir?: string;
  outFile?: string;
  target?: string;
  minify?: boolean;
  sourcemap?: boolean;
  external?: string[];
}

export interface EmailTemplatesConfig {
  sourceDir: string;
  outputDir: string;
  layoutFile?: string;
  layoutMarker?: string;
  templateExtension?: string;
  excludeDirs?: string[];
}

export interface JobsConfig {
  workerEntrypoint?: string;
  workerOutFile?: string;
  schedulerEntrypoint?: string;
}

export interface LambdaConfig {
  runtime?: string;
  architecture?: 'arm64' | 'x86_64';
  memory?: number;
  timeout?: number;
  environment?: Record<string, string>;
  layers?: string[];
}

export interface InfrastructureConfig {
  api?: {
    type?: 'function-url' | 'api-gateway';
    cors?: boolean;
  };
  cdn?: {
    enabled?: boolean;
    domainName?: string;
    certificateArn?: string;
  };
  staticSite?: {
    distDir: string;
    indexDocument?: string;
  };
  queues?: Record<string, { visibilityTimeout?: number }>;
  tables?: Record<string, { billingMode?: string; ttl?: string }>;
  samOutput?: string;
}

export interface BuildHookContext {
  config: ResolvedGlassworkCliConfig;
  duration?: number;
}

export type BuildHook = (context: BuildHookContext) => void | Promise<void>;

export interface BuildHooks {
  'build:before'?: BuildHook;
  'build:after'?: BuildHook;
}

export interface GlassworkCliConfig {
  name?: string;
  region?: string;
  build?: BuildConfig;
  email?: {
    templates?: EmailTemplatesConfig;
  };
  jobs?: JobsConfig;
  lambda?: LambdaConfig;
  infrastructure?: InfrastructureConfig;
  hooks?: BuildHooks;
}

export interface ResolvedBuildConfig extends Required<Omit<BuildConfig, 'external'>> {
  external: string[];
}

export interface ResolvedEmailTemplatesConfig extends EmailTemplatesConfig {
  sourceDir: string;
  outputDir: string;
}

export interface ResolvedJobsConfig extends JobsConfig {
  workerEntrypoint?: string;
  workerOutFile: string;
  schedulerEntrypoint?: string;
}

export interface ResolvedInfrastructureConfig extends InfrastructureConfig {
  samOutput: string;
}

export interface ResolvedGlassworkCliConfig extends GlassworkCliConfig {
  rootDir: string;
  build: ResolvedBuildConfig;
  email?: {
    templates?: ResolvedEmailTemplatesConfig;
  };
  jobs?: ResolvedJobsConfig;
  lambda: Required<LambdaConfig>;
  infrastructure?: ResolvedInfrastructureConfig;
  hooks?: BuildHooks;
}

const BuildConfigSchema = object({
  entrypoint: optional(string()),
  outDir: optional(string()),
  outFile: optional(string()),
  target: optional(string()),
  minify: optional(boolean()),
  sourcemap: optional(boolean()),
  external: optional(array(string())),
});

const EmailTemplatesConfigSchema = object({
  sourceDir: string(),
  outputDir: string(),
  layoutFile: optional(string()),
  layoutMarker: optional(string()),
  templateExtension: optional(string()),
  excludeDirs: optional(array(string())),
});

const JobsConfigSchema = object({
  workerEntrypoint: optional(string()),
  workerOutFile: optional(string()),
  schedulerEntrypoint: optional(string()),
});

const LambdaConfigSchema = object({
  runtime: optional(string()),
  architecture: optional(string()),
  memory: optional(number()),
  timeout: optional(number()),
  environment: optional(record(string(), string())),
  layers: optional(array(string())),
});

const InfrastructureConfigSchema = object({
  api: optional(
    object({
      type: optional(string()),
      cors: optional(boolean()),
    })
  ),
  cdn: optional(
    object({
      enabled: optional(boolean()),
      domainName: optional(string()),
      certificateArn: optional(string()),
    })
  ),
  staticSite: optional(
    object({
      distDir: string(),
      indexDocument: optional(string()),
    })
  ),
  queues: optional(record(string(), object({ visibilityTimeout: optional(number()) }))),
  tables: optional(
    record(string(), object({ billingMode: optional(string()), ttl: optional(string()) }))
  ),
  samOutput: optional(string()),
});

const CliConfigSchema = object({
  name: optional(string()),
  region: optional(string()),
  build: optional(BuildConfigSchema),
  email: optional(
    object({
      templates: optional(EmailTemplatesConfigSchema),
    })
  ),
  jobs: optional(JobsConfigSchema),
  lambda: optional(LambdaConfigSchema),
  infrastructure: optional(InfrastructureConfigSchema),
});

export interface LoadCliConfigOptions {
  cwd?: string;
  overrides?: Partial<GlassworkCliConfig>;
}

export function defineConfig(config: GlassworkCliConfig): GlassworkCliConfig {
  return config;
}

export async function loadCliConfig(
  options: LoadCliConfigOptions = {}
): Promise<ResolvedGlassworkCliConfig> {
  const { config, ...meta } = await loadC12Config<GlassworkCliConfig>({
    name: 'glasswork',
    cwd: options.cwd,
    overrides: options.overrides,
  });

  if (!config) {
    throw new Error(
      `Unable to find glasswork.config.* in ${options.cwd || process.cwd()}. ` +
        'Create a configuration file to continue.'
    );
  }

  const parsed = parse(CliConfigSchema, config);

  const configFile =
    (meta as { configFile?: string }).configFile || (meta as { filepath?: string }).filepath;

  const rootDir = configFile ? dirname(configFile) : resolve(options.cwd || process.cwd());

  return applyDefaultsAndResolve(parsed, rootDir, config.hooks);
}

function applyDefaultsAndResolve(
  config: GlassworkCliConfig,
  rootDir: string,
  hooks: BuildHooks | undefined
): ResolvedGlassworkCliConfig {
  const build = resolveBuildConfig(config, rootDir);
  const emailTemplates = resolveEmailTemplates(config, rootDir);
  const jobs = resolveJobsConfig(config, rootDir);
  const lambda = resolveLambdaConfig(config);
  const infrastructure = resolveInfrastructureConfig(config, rootDir);
  const normalizedHooks = extractHooks(hooks);

  return {
    ...config,
    build,
    email: emailTemplates ? { templates: emailTemplates } : undefined,
    jobs,
    lambda,
    infrastructure,
    rootDir,
    hooks: normalizedHooks,
  };
}

function resolveBuildConfig(config: GlassworkCliConfig, rootDir: string): ResolvedBuildConfig {
  return {
    entrypoint: resolve(rootDir, config.build?.entrypoint || 'src/server.ts'),
    outDir: resolve(rootDir, config.build?.outDir || 'dist'),
    outFile: config.build?.outFile || 'api.mjs',
    target: config.build?.target || 'node22',
    minify: config.build?.minify ?? true,
    sourcemap: config.build?.sourcemap ?? false,
    external: config.build?.external || [],
  };
}

function resolveEmailTemplates(
  config: GlassworkCliConfig,
  rootDir: string
): ResolvedEmailTemplatesConfig | undefined {
  if (!config.email?.templates) return undefined;

  return {
    ...config.email.templates,
    sourceDir: resolve(rootDir, config.email.templates.sourceDir),
    outputDir: resolve(rootDir, config.email.templates.outputDir),
  };
}

function resolveJobsConfig(
  config: GlassworkCliConfig,
  rootDir: string
): ResolvedJobsConfig | undefined {
  if (!config.jobs) return undefined;

  return {
    workerEntrypoint: config.jobs.workerEntrypoint
      ? resolve(rootDir, config.jobs.workerEntrypoint)
      : undefined,
    workerOutFile: config.jobs.workerOutFile || 'worker.mjs',
    schedulerEntrypoint: config.jobs.schedulerEntrypoint
      ? resolve(rootDir, config.jobs.schedulerEntrypoint)
      : undefined,
  };
}

function resolveLambdaConfig(config: GlassworkCliConfig): Required<LambdaConfig> {
  return {
    runtime: config.lambda?.runtime || 'nodejs22.x',
    architecture: (config.lambda?.architecture as 'arm64' | 'x86_64') || 'arm64',
    memory: config.lambda?.memory ?? 512,
    timeout: config.lambda?.timeout ?? 30,
    environment: config.lambda?.environment || {},
    layers: config.lambda?.layers || [],
  };
}

function resolveInfrastructureConfig(
  config: GlassworkCliConfig,
  rootDir: string
): ResolvedInfrastructureConfig | undefined {
  if (!config.infrastructure) return undefined;

  return {
    ...config.infrastructure,
    samOutput: resolve(rootDir, config.infrastructure.samOutput || 'template.yaml'),
  };
}

function extractHooks(hooks: BuildHooks | undefined): BuildHooks | undefined {
  if (!hooks) return undefined;

  const normalized: BuildHooks = {};

  if (typeof hooks['build:before'] === 'function') {
    normalized['build:before'] = hooks['build:before'];
  }

  if (typeof hooks['build:after'] === 'function') {
    normalized['build:after'] = hooks['build:after'];
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

// Used by tests to validate schemas directly when needed
export function validateCliConfig<TConfig extends BaseSchema<unknown>>(
  schema: TConfig,
  config: Record<string, unknown>
) {
  return parse(schema, config);
}
