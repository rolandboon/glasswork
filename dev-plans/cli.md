# CLI Development Plan for Glasswork

## Executive Summary

This document outlines the plan to add a CLI to Glasswork that handles build orchestration, development workflow, and infrastructure deployment. The CLI will provide a unified interface similar to `nest build`/`nest dev` while supporting the multi-phase build process required by Glasswork applications (email templates, jobs, Lambda bundling).

## Background & Context

### Current State

Route Rangers currently has a manual build process:

```json
"build": "tsx scripts/compile-templates.ts && tsx build.ts"
```

And deployment via a bash script (`bin/deploy`) that orchestrates:
1. Backend build (templates + esbuild)
2. Frontend build (Vite)
3. SAM build & deploy
4. S3 sync for static assets
5. CloudFront invalidation

### Framework Principles

1. **Lambda-First**: Optimize for cold start times and bundle size
2. **Transparency**: Allow easy customization; don't hide underlying tools
3. **Great DX**: Make common tasks simple, complex tasks possible
4. **Type Safety**: Leverage TypeScript throughout

### Goals

1. **Unified Build Command**: `glasswork build` handles all build phases
2. **Development Server**: `glasswork dev` with watch mode and hot reload
3. **Infrastructure Generation**: Generate deployment configuration
4. **Extensibility**: Plugin system for custom build phases

---

## Design Decisions

| Topic | Decision | Rationale |
|-------|----------|-----------|
| **Infrastructure Tooling** | Generate SAM/CDK from `glasswork.config.ts` | Single config file, framework-specific optimizations, leverages battle-tested deployment tools |
| **Configuration Format** | TypeScript (`glasswork.config.ts`) | IDE autocomplete, type safety, dynamic configuration, inline comments |
| **Package Distribution** | Integrate in Glasswork for now | Extract it at a later time |
| **Development Server** | Fast Node.js + SAM Local option | `glasswork dev` for speed, `glasswork dev --lambda` for Lambda-accurate testing |
| **Build Extensibility** | Build hooks for v1 | Simple extensibility via hooks; plugin system deferred to v2 |

---

## Architecture

### CLI Commands Overview

```
glasswork
├── dev           # Start development server with watch mode
├── build         # Build for production
├── deploy        # Deploy to AWS
├── generate      # Generate infrastructure files
│   ├── sam       # Generate SAM template
│   └── cdk       # Generate CDK stack
├── email         # Email-related commands
│   ├── compile   # Compile email templates
│   └── preview   # Preview email template
├── db            # Database commands (Prisma wrapper)
│   ├── migrate   # Run migrations
│   ├── generate  # Generate Prisma client
│   └── studio    # Open Prisma Studio
└── new           # Create new project/module (future)
```

### Configuration Schema

```typescript
// glasswork.config.ts
import { defineConfig } from 'glasswork';

export default defineConfig({
  // Project metadata
  name: 'my-app',
  region: 'eu-central-1',

  // Build configuration
  build: {
    entrypoint: 'src/server.ts',
    outDir: 'dist',
    outFile: 'api.mjs',
    target: 'node22',
    minify: true,
    sourcemap: false,
    external: ['@aws-sdk/*'],  // Don't bundle AWS SDK
  },

  // Email templates (optional)
  email: {
    templates: {
      sourceDir: 'src/modules/email/templates',
      outputDir: 'src/modules/email/compiled',
      excludeDirs: ['layouts'],
    },
  },

  // Background jobs (optional)
  jobs: {
    workerEntrypoint: 'src/worker.ts',
    workerOutFile: 'worker.mjs',
    schedulerEntrypoint: 'src/scheduler.ts',  // For long delays
  },

  // Lambda configuration
  lambda: {
    runtime: 'nodejs22.x',
    architecture: 'arm64',
    memory: 512,
    timeout: 30,
    environment: {
      TZ: 'Europe/Amsterdam',
    },
    layers: [],
  },

  // Infrastructure
  infrastructure: {
    // API Gateway / Function URL
    api: {
      type: 'function-url',  // or 'api-gateway'
      cors: true,
    },

    // CloudFront (optional)
    cdn: {
      enabled: true,
      domainName: 'example.com',
      certificateArn: 'arn:aws:acm:...',
    },

    // Static site (optional)
    staticSite: {
      distDir: '../frontend/dist',
      indexDocument: 'index.html',
    },

    // Job queues (auto-configured if jobs enabled)
    queues: {
      default: { visibilityTimeout: 300 },
      emails: { visibilityTimeout: 300 },
    },

    // DynamoDB tables
    tables: {
      rateLimit: {
        billingMode: 'PAY_PER_REQUEST',
        ttl: 'expiresAt',
      },
    },
  },

  // Build hooks
  hooks: {
    'build:before': async (ctx) => {
      console.log('Starting build...');
    },
    'build:after': async (ctx) => {
      console.log(`Built in ${ctx.duration}ms`);
    },
  },
});
```

### Build Pipeline

```
┌─────────────────────────────────────────────────────────────────────┐
│                        glasswork build                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────┐  │
│  │ hook:before  │───▶│   Phase 1    │───▶│      Phase 2         │  │
│  │              │    │   Templates  │    │    TypeScript        │  │
│  └──────────────┘    │  (MJML→TS)   │    │   Compilation        │  │
│                      └──────────────┘    └──────────────────────┘  │
│                                                     │               │
│                                                     ▼               │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────┐  │
│  │ hook:after   │◀───│   Phase 4    │◀───│      Phase 3         │  │
│  │              │    │  Generate    │    │      Bundle          │  │
│  └──────────────┘    │  Infra (SAM) │    │     (esbuild)        │  │
│                      └──────────────┘    └──────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Dev Server Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         glasswork dev                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                    File Watcher (chokidar)                   │  │
│  └──────────────────────────────────────────────────────────────┘  │
│           │                    │                    │               │
│           ▼                    ▼                    ▼               │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────────┐   │
│  │ *.mjml changed │  │ *.ts changed   │  │ config changed     │   │
│  │ → recompile    │  │ → restart      │  │ → full restart     │   │
│  │   templates    │  │   server       │  │                    │   │
│  └────────────────┘  └────────────────┘  └────────────────────┘   │
│           │                    │                                    │
│           └────────────────────┼────────────────────────────────┐  │
│                                ▼                                │  │
│                    ┌──────────────────────┐                     │  │
│                    │   Hono Dev Server    │◀────────────────────┘  │
│                    │   (tsx watch)        │                        │
│                    │   Port: 3000         │                        │
│                    └──────────────────────┘                        │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## CLI Implementation

### Tech Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| CLI Framework | **citty** | Modern, lightweight, TypeScript-native, from UnJS ecosystem |
| Config Loading | **c12** | Config loader from UnJS, supports TS/JS/JSON/YAML |
| File Watching | **chokidar** | Battle-tested, cross-platform |
| Bundling | **esbuild** | Fast, already used in project |
| Colors/Output | **consola** | Beautiful console output, from UnJS |
| Prompts | **@clack/prompts** | Beautiful interactive prompts |

### Command Implementations

#### `glasswork dev`

```typescript
// commands/dev.ts
import { defineCommand } from 'citty';
import { loadConfig } from '../config/loader';
import { startDevServer } from '../dev/server';
import { watchTemplates } from '../build/templates';

export default defineCommand({
  meta: {
    name: 'dev',
    description: 'Start development server with watch mode',
  },
  args: {
    port: {
      type: 'string',
      default: '3000',
      description: 'Port to run dev server on',
    },
    lambda: {
      type: 'boolean',
      default: false,
      description: 'Use SAM Local for Lambda-accurate environment',
    },
  },
  async run({ args }) {
    const config = await loadConfig();

    // Initial template compilation
    if (config.email?.templates) {
      await compileTemplates(config.email.templates);
    }

    if (args.lambda) {
      // Use SAM Local
      await startSAMLocal(config);
    } else {
      // Fast Node.js dev server
      await startDevServer(config, {
        port: parseInt(args.port),
        onRestart: () => console.log('Server restarted'),
      });
    }

    // Watch for template changes
    if (config.email?.templates) {
      watchTemplates(config.email.templates, {
        onCompile: () => console.log('Templates recompiled'),
      });
    }
  },
});
```

#### `glasswork build`

```typescript
// commands/build.ts
import { defineCommand } from 'citty';
import { loadConfig } from '../config/loader';
import { BuildPipeline } from '../build/pipeline';

export default defineCommand({
  meta: {
    name: 'build',
    description: 'Build for production',
  },
  args: {
    analyze: {
      type: 'boolean',
      default: false,
      description: 'Show bundle analysis',
    },
  },
  async run({ args }) {
    const config = await loadConfig();
    const pipeline = new BuildPipeline(config);

    // Run build hooks
    await config.hooks?.['build:before']?.({ config });

    const startTime = Date.now();

    // Phase 1: Compile templates
    if (config.email?.templates) {
      console.log('📧 Compiling email templates...');
      const result = await pipeline.compileTemplates();
      console.log(`   Compiled ${result.count} templates`);
    }

    // Phase 2: Bundle Lambda
    console.log('📦 Bundling Lambda...');
    const bundleResult = await pipeline.bundle();

    if (args.analyze) {
      console.log(bundleResult.analysis);
    }

    // Phase 3: Bundle worker (if jobs configured)
    if (config.jobs?.workerEntrypoint) {
      console.log('👷 Bundling worker...');
      await pipeline.bundleWorker();
    }

    // Phase 4: Generate infrastructure
    if (config.infrastructure) {
      console.log('🏗️  Generating infrastructure...');
      await pipeline.generateInfrastructure();
    }

    const duration = Date.now() - startTime;
    await config.hooks?.['build:after']?.({ config, duration });

    console.log(`\n✅ Build completed in ${duration}ms`);
  },
});
```

#### `glasswork deploy`

```typescript
// commands/deploy.ts
import { defineCommand } from 'citty';
import { loadConfig } from '../config/loader';
import { execSync } from 'node:child_process';

export default defineCommand({
  meta: {
    name: 'deploy',
    description: 'Deploy to AWS',
  },
  args: {
    stage: {
      type: 'string',
      default: 'production',
      description: 'Deployment stage',
    },
    'skip-build': {
      type: 'boolean',
      default: false,
      description: 'Skip build step',
    },
  },
  async run({ args }) {
    const config = await loadConfig();

    // Build first (unless skipped)
    if (!args['skip-build']) {
      console.log('🔨 Building...');
      await runBuild(config);
    }

    // Deploy with SAM
    console.log('🚀 Deploying...');
    execSync('sam build', { stdio: 'inherit' });
    execSync('sam deploy --no-fail-on-empty-changeset --no-confirm-changeset', {
      stdio: 'inherit',
    });

    // Sync static assets (if CDN configured)
    if (config.infrastructure?.staticSite) {
      console.log('📁 Syncing static assets...');
      await syncStaticAssets(config);
    }

    console.log('\n✅ Deployment complete!');
  },
});
```

#### `glasswork generate sam`

```typescript
// commands/generate/sam.ts
import { defineCommand } from 'citty';
import { loadConfig } from '../../config/loader';
import { generateSAMTemplate } from '../../generators/sam';

export default defineCommand({
  meta: {
    name: 'sam',
    description: 'Generate AWS SAM template from config',
  },
  args: {
    output: {
      type: 'string',
      default: 'template.yaml',
      description: 'Output file path',
    },
  },
  async run({ args }) {
    const config = await loadConfig();

    console.log('🏗️  Generating SAM template...');
    const template = generateSAMTemplate(config);

    await writeFile(args.output, template);
    console.log(`✅ Generated ${args.output}`);
  },
});
```

---

## Infrastructure Generation

### SAM Template Generator

```typescript
// generators/sam.ts
import { GlassworkConfig } from '../config/schema';
import * as yaml from 'yaml';

export function generateSAMTemplate(config: GlassworkConfig): string {
  const template: SAMTemplate = {
    AWSTemplateFormatVersion: '2010-09-09',
    Transform: 'AWS::Serverless-2016-10-31',

    Parameters: generateParameters(config),
    Resources: {
      ...generateLambdaResources(config),
      ...generateQueueResources(config),
      ...generateTableResources(config),
      ...generateCDNResources(config),
    },
    Outputs: generateOutputs(config),
  };

  return yaml.stringify(template);
}

function generateLambdaResources(config: GlassworkConfig) {
  const resources: Record<string, any> = {};

  // Main API Lambda
  resources.ApiFunction = {
    Type: 'AWS::Serverless::Function',
    Properties: {
      CodeUri: config.build.outDir,
      Handler: `${config.build.outFile.replace('.mjs', '')}.handler`,
      Runtime: config.lambda.runtime,
      Architectures: [config.lambda.architecture],
      MemorySize: config.lambda.memory,
      Timeout: config.lambda.timeout,
      Environment: {
        Variables: config.lambda.environment,
      },
      FunctionUrlConfig: config.infrastructure?.api?.type === 'function-url'
        ? { AuthType: 'NONE' }
        : undefined,
    },
  };

  // Worker Lambda (if jobs configured)
  if (config.jobs?.workerEntrypoint) {
    resources.WorkerFunction = {
      Type: 'AWS::Serverless::Function',
      Properties: {
        CodeUri: config.build.outDir,
        Handler: `${config.jobs.workerOutFile?.replace('.mjs', '') || 'worker'}.handler`,
        Runtime: config.lambda.runtime,
        Timeout: 300,
        Events: {
          SQSEvent: {
            Type: 'SQS',
            Properties: {
              Queue: { 'Fn::GetAtt': ['JobQueue', 'Arn'] },
              BatchSize: 10,
              FunctionResponseTypes: ['ReportBatchItemFailures'],
            },
          },
        },
      },
    };
  }

  return resources;
}

function generateQueueResources(config: GlassworkConfig) {
  if (!config.infrastructure?.queues) return {};

  const resources: Record<string, any> = {};

  for (const [name, queueConfig] of Object.entries(config.infrastructure.queues)) {
    const pascalName = toPascalCase(name);

    resources[`${pascalName}Queue`] = {
      Type: 'AWS::SQS::Queue',
      Properties: {
        QueueName: `\${AWS::StackName}-${name}`,
        VisibilityTimeout: queueConfig.visibilityTimeout || 300,
        RedrivePolicy: {
          deadLetterTargetArn: { 'Fn::GetAtt': [`${pascalName}DLQ`, 'Arn'] },
          maxReceiveCount: 3,
        },
      },
    };

    resources[`${pascalName}DLQ`] = {
      Type: 'AWS::SQS::Queue',
      Properties: {
        QueueName: `\${AWS::StackName}-${name}-dlq`,
        MessageRetentionPeriod: 1209600,
      },
    };
  }

  return resources;
}
```

### Future: CDK Generator

```typescript
// generators/cdk.ts (Phase 2)
import { GlassworkConfig } from '../config/schema';

export function generateCDKStack(config: GlassworkConfig): string {
  return `
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

export class ${toPascalCase(config.name)}Stack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // API Lambda
    const apiFunction = new lambda.Function(this, 'ApiFunction', {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      handler: '${config.build.outFile.replace('.mjs', '')}.handler',
      code: lambda.Code.fromAsset('${config.build.outDir}'),
      memorySize: ${config.lambda.memory},
      timeout: cdk.Duration.seconds(${config.lambda.timeout}),
    });

    // Function URL
    const fnUrl = apiFunction.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
    });

    new cdk.CfnOutput(this, 'ApiUrl', { value: fnUrl.url });
  }
}
`;
}
```

---

## Package Structure

```
packages/glasswork-cli/
├── src/
│   ├── index.ts              # CLI entry point
│   ├── commands/
│   │   ├── dev.ts
│   │   ├── build.ts
│   │   ├── deploy.ts
│   │   ├── generate/
│   │   │   ├── sam.ts
│   │   │   └── cdk.ts
│   │   └── email/
│   │       ├── compile.ts
│   │       └── preview.ts
│   ├── config/
│   │   ├── loader.ts         # Load glasswork.config.ts
│   │   ├── schema.ts         # Valibot schema for config
│   │   └── defaults.ts       # Default configuration
│   ├── build/
│   │   ├── pipeline.ts       # Build orchestration
│   │   ├── templates.ts      # Template compilation
│   │   ├── bundle.ts         # esbuild wrapper
│   │   └── worker.ts         # Worker bundling
│   ├── dev/
│   │   ├── server.ts         # Dev server
│   │   ├── watcher.ts        # File watching
│   │   └── sam-local.ts      # SAM Local integration
│   ├── generators/
│   │   ├── sam.ts            # SAM template generator
│   │   └── cdk.ts            # CDK stack generator
│   └── utils/
│       ├── console.ts        # Console output helpers
│       └── exec.ts           # Shell execution helpers
├── bin/
│   └── glasswork.js          # CLI binary
├── package.json
└── tsconfig.json
```

---

## Dependencies

```json
{
  "name": "glasswork",
  "version": "0.1.0",
  "bin": {
    "glasswork": "./bin/glasswork.js"
  },
  "dependencies": {
    "citty": "^0.1.6",
    "c12": "^2.0.1",
    "consola": "^3.4.0",
    "chokidar": "^4.0.3",
    "@clack/prompts": "^0.9.1",
    "esbuild": "^0.27.0",
    "yaml": "^2.7.1",
    "valibot": "^1.2.0"
  },
  "peerDependencies": {
    "mjml": "^4.17.0",
    "typescript": "^5.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.20.0"
  }
}
```

---

## Implementation Phases

### Phase 1: Core CLI Infrastructure
**Goal**: Basic CLI with build command

**Deliverables**:
1. CLI framework setup (citty)
2. Configuration loading (`glasswork.config.ts`)
3. Configuration schema with Valibot validation
4. `glasswork build` command
5. Template compilation integration
6. esbuild bundling
7. Basic console output

### Phase 2: Development Server
**Goal**: `glasswork dev` with watch mode

**Deliverables**:
1. Dev server using `tsx watch`
2. File watcher for templates
3. Auto-restart on TypeScript changes
4. Template hot-recompilation
5. Colored console output with consola

### Phase 3: Infrastructure Generation
**Goal**: Generate deployment configurations

**Deliverables**:
1. `glasswork generate sam` command
2. SAM template generator from config
3. Queue/DLQ resource generation
4. DynamoDB table generation
5. CloudFront/S3 generation for CDN

### Phase 4: Deployment
**Goal**: `glasswork deploy` for production

**Deliverables**:
1. `glasswork deploy` command
2. SAM build/deploy integration
3. Static asset S3 sync
4. CloudFront invalidation
5. Stage support (dev, staging, production)

### Phase 5: CDK Support
**Goal**: Alternative CDK output

**Deliverables**:
1. `glasswork generate cdk` command
2. CDK stack generator
3. CDK constructs for common patterns
4. CDK deploy integration

### Phase 6: Enhanced DX
**Goal**: Polish and additional features

**Deliverables**:
1. `glasswork new` project scaffolding
2. `glasswork email preview` command
3. Interactive prompts for missing config
4. Plugin system for custom build phases
5. `glasswork db` commands (Prisma wrappers)
6. Comprehensive documentation

---

## Configuration Examples

### Minimal Configuration

```typescript
// glasswork.config.ts
import { defineConfig } from 'glasswork';

export default defineConfig({
  name: 'my-api',
  build: {
    entrypoint: 'src/server.ts',
  },
});
```

### Full Configuration

```typescript
// glasswork.config.ts
import { defineConfig } from 'glasswork';

export default defineConfig({
  name: 'route-rangers',
  region: 'eu-central-1',

  build: {
    entrypoint: 'src/server.ts',
    outDir: 'dist',
    outFile: 'api.mjs',
    target: 'node22',
    minify: true,
    external: ['@aws-sdk/*'],
  },

  email: {
    templates: {
      sourceDir: 'src/modules/email/templates',
      outputDir: 'src/modules/email/compiled',
      excludeDirs: ['layouts'],
    },
  },

  jobs: {
    workerEntrypoint: 'src/worker.ts',
    workerOutFile: 'worker.mjs',
  },

  lambda: {
    runtime: 'nodejs22.x',
    architecture: 'arm64',
    memory: 512,
    timeout: 30,
    environment: {
      TZ: 'Europe/Amsterdam',
    },
    layers: [
      'arn:aws:lambda:eu-central-1:615299751070:layer:AWSOpenTelemetryDistroJs:10',
    ],
  },

  infrastructure: {
    api: {
      type: 'function-url',
    },

    cdn: {
      enabled: true,
      domainName: 'routerangers.example.com',
      certificateArn: 'arn:aws:acm:us-east-1:...',
    },

    staticSite: {
      distDir: '../frontend/dist',
    },

    queues: {
      default: { visibilityTimeout: 300 },
      emails: { visibilityTimeout: 300 },
    },

    tables: {
      rateLimit: {
        billingMode: 'PAY_PER_REQUEST',
        ttl: 'expiresAt',
      },
      scheduledJobs: {
        billingMode: 'PAY_PER_REQUEST',
        ttl: 'ttl',
      },
    },

    ses: {
      configurationSet: 'RouteRangersCfgSet',
      snsTopicForEvents: true,
    },
  },

  hooks: {
    'build:before': async () => {
      console.log('🚀 Starting build...');
    },
    'build:after': async ({ duration }) => {
      console.log(`✅ Built in ${duration}ms`);
    },
  },
});
```

---

## Success Criteria

A successful CLI for Glasswork will:

1. ✅ Provide unified `build` command handling all phases (templates → bundle → infra)
2. ✅ Support `dev` mode with fast Node.js server and optional SAM Local
3. ✅ Use TypeScript config (`glasswork.config.ts`) with full type safety
4. ✅ Generate SAM templates from configuration (CDK in Phase 5)
5. ✅ Deploy with single `glasswork deploy` command
6. ✅ Have beautiful, informative console output (consola)
7. ✅ Integrate email template compilation from `@glasswork/email`
8. ✅ Integrate worker Lambda bundling from `@glasswork/jobs`
9. ✅ Be extensible via build hooks
10. ✅ Follow Glasswork's transparency principle (underlying tools accessible)
11. ✅ Distributed as separate `glasswork` package
12. ✅ Have comprehensive documentation

---

## Next Steps

1. **Technical Spike**: Validate config loading with c12
   - Test TypeScript config parsing
   - Verify SAM template generation matches current template.yaml
2. **Phase 1**: Build core CLI infrastructure
3. **Iterate**: Get feedback on DX
4. **Document**: Write guides alongside implementation

