---
description: Deploying Glasswork to AWS Lambda with AWS CDK in TypeScript, including ESM bundling, Function URLs, and alternative deployment tools.
---

# Lambda Deployment

Glasswork is optimized for AWS Lambda with small bundle sizes, fast cold starts, and native compatibility. This guide covers building and deploying your application to Lambda.

## Supported Versions

- Node.js 20, 22 or 24 runtimes
- ESM bundles with top-level `await`
- esbuild (v0.19+) for examples shown here

## Lambda-Ready by Default

Glasswork applications are Lambda-ready out of the box:

```typescript
// src/server.ts
import { serve } from '@hono/node-server';
import { bootstrap, isLambda } from 'glasswork/core';
import { handle } from 'hono/aws-lambda';
import { AppModule } from './app.module';

const { app } = await bootstrap(AppModule, {
  openapi: {
    enabled: true,
    serveSpecs: !isLambda(), // Only serve locally
    serveUI: !isLambda(),
  },
});

// Export handler for Lambda
export const handler = handle(app);

// Start local server if not in Lambda
if (!isLambda()) {
  const port = Number(process.env.PORT) || 3000;
  console.log(`Server running on http://localhost:${port}`);
  serve({ fetch: app.fetch, port });
}
```

The same code runs locally and in Lambda without changes.

This example covers request-response routes. It uses Hono's buffered `handle` adapter;
the in-memory `glasswork/sse` broadcaster does not work for cross-invocation
notifications in this deployment. See [Server-Sent Events](/sse/getting-started#deployment-compatibility)
for the streaming and shared event source requirements.

## Project Configuration

### TypeScript Configuration

Glasswork uses async `bootstrap()` which requires top-level await. Configure TypeScript for ESM:

```json
// tsconfig.json
{
  "compilerOptions": {
    "lib": ["es2024"],
    "module": "ESNext",
    "target": "es2022",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "declaration": true
  },
  "include": ["src/**/*"]
}
```

### Package Configuration

Enable ESM in your package.json:

```json
// package.json
{
  "type": "module",
  "scripts": {
    "build": "tsx build.ts",
    "dev": "tsx watch src/server.ts"
  }
}
```

## Building for Lambda

### esbuild Configuration

Use esbuild to create optimized ESM Lambda bundles:

```typescript
// build.ts
import * as esbuild from 'esbuild';
import { analyzeMetafile } from 'esbuild';

const sharedConfig: esbuild.BuildOptions = {
  platform: 'node',
  target: 'node22',
  format: 'esm',
  bundle: true,
  minify: true,
  keepNames: true, // Required for Awilix PROXY mode
  sourcemap: false,
  metafile: true,
  external: ['@aws-sdk/*'], // AWS SDK available in Lambda runtime
  treeShaking: true,
  drop: ['debugger'],
  // Create require() shim for ESM bundles that include CJS dependencies
  banner: {
    js: `import { createRequire } from 'module'; const require = createRequire(import.meta.url);`,
  },
};

async function build() {
  try {
    const result = await esbuild.build({
      ...sharedConfig,
      entryPoints: ['src/server.ts'],
      outfile: 'dist/api.mjs', // Use .mjs extension for ESM
    });

    if (result.metafile) {
      const analysis = await analyzeMetafile(result.metafile);
      console.log('Bundle analysis:', analysis);
    }

    console.log('Build completed successfully');
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

build();
```

**Key settings:**

- `format: 'esm'` - ESM format for top-level await support
- `keepNames: true` - **Critical** for Awilix dependency injection (preserves class/property names)
- `external: ['@aws-sdk/*']` - Excludes AWS SDK (included in Lambda runtime)
- `minify: true` - Reduces bundle size for faster cold starts
- `treeShaking: true` - Removes unused code
- `banner.js` - Creates `require()` shim for CJS dependencies (like Prisma)
- `outfile: 'dist/api.mjs'` - Use `.mjs` extension so Lambda recognizes ESM

**Install esbuild:**

:::: code-group

```bash [npm]
npm install -D esbuild tsx
```

```bash [pnpm]
pnpm add -D esbuild tsx
```

```bash [yarn]
yarn add -D esbuild tsx
```

::::

### Bundle Size

Expect bundle sizes under 1MB:

- Glasswork + Hono + Valibot: ~200-300KB
- With Prisma: ~800KB-1MB
- Cold start: 100-300ms

## Deployment Options

AWS CDK v2 in TypeScript is the primary deployment path used throughout these
docs. SAM, Serverless Framework, and Terraform are also supported: Glasswork
exports an ordinary Lambda handler and does not depend on a deployment tool.

### AWS CDK

Install CDK's constructs and local build tools in your application project:

:::: code-group

```bash [npm]
npm install aws-cdk-lib constructs
npm install -D aws-cdk tsx esbuild @types/node
```

```bash [pnpm]
pnpm add aws-cdk-lib constructs
pnpm add -D aws-cdk tsx esbuild @types/node
```

```bash [yarn]
yarn add aws-cdk-lib constructs
yarn add -D aws-cdk tsx esbuild @types/node
```

::::

`NodejsFunction` bundles the TypeScript entry point with esbuild during synthesis;
there is no separate `npm run build` step for this path. Keep your application's
lockfile available to CDK (set `depsLockFilePath` explicitly in a monorepo if
necessary). The [CDK Node.js Lambda guide](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda_nodejs-readme.html)
covers bundling and native dependencies.

```typescript
// lib/api-stack.ts
import { CfnOutput, Duration, Stack, type StackProps } from 'aws-cdk-lib';
import { Architecture, FunctionUrlAuthType, HttpMethod, Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import type { Construct } from 'constructs';

export class ApiStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const apiFunction = new NodejsFunction(this, 'ApiFunction', {
      entry: 'src/server.ts',
      handler: 'handler',
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(10),
      bundling: {
        format: OutputFormat.ESM, // Required for top-level await
        minify: true,
        target: 'node24',
        keepNames: true, // Required for Awilix
        externalModules: ['@aws-sdk/*'], // Use the selected Lambda runtime's SDK
        banner:
          "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
      },
      environment: { NODE_ENV: 'production' },
    });
    const functionUrl = apiFunction.addFunctionUrl({
      authType: FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: ['https://example.com'],
        allowedMethods: [HttpMethod.ALL],
        allowedHeaders: ['*'],
      },
    });
    new CfnOutput(this, 'ApiUrl', { value: functionUrl.url });
  }
}
```

The public Function URL lets clients reach the API; application routes still
use their configured authentication and authorization. Add application
configuration through environment variables or the SSM provider described below.

Create the CDK app entry point:

```typescript
// bin/app.ts
import { App } from 'aws-cdk-lib';
import { ApiStack } from '../lib/api-stack';

const app = new App();
new ApiStack(app, 'ApiStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
});
```

```json
// cdk.json
{
  "app": "npx tsx bin/app.ts"
}
```

With AWS credentials and a deployment region configured:

```bash
# Once per AWS account/region
npx cdk bootstrap

# Review the generated template and deploy
npx cdk synth
npx cdk diff
npx cdk deploy
```

### AWS SAM

AWS Serverless Application Model (SAM) provides a simple deployment experience.

**template.yaml:**

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31

Resources:
  ApiFunction:
    Type: AWS::Serverless::Function
    Properties:
      CodeUri: dist/
      Handler: api.handler
      Runtime: nodejs22.x
      Architectures:
        - arm64  # Graviton2: Better price/performance
      MemorySize: 256
      Timeout: 10
      Environment:
        Variables:
          NODE_OPTIONS: '--max-old-space-size=256'
          DATABASE_URL: !Ref DatabaseUrl
      FunctionUrlConfig:
        AuthType: NONE
        Cors:
          AllowOrigins:
            - 'https://example.com'
          AllowMethods:
            - GET
            - POST
            - PUT
            - PATCH
            - DELETE
          AllowHeaders:
            - '*'

Parameters:
  DatabaseUrl:
    Type: String
    Description: Database connection string
```

**Deploy:**

```bash
npm run build
sam build
sam deploy --guided
```

### Serverless Framework

Configuration-driven deployment:

```yaml
# serverless.yml
service: glasswork-api

provider:
  name: aws
  runtime: nodejs22.x
  memorySize: 256
  timeout: 10
  environment:
    NODE_OPTIONS: '--max-old-space-size=256'
    DATABASE_URL: ${env:DATABASE_URL}

functions:
  api:
    handler: dist/api.handler
    architecture: arm64  # Graviton2: Better price/performance
    url:
      cors:
        allowedOrigins:
          - https://example.com
        allowedHeaders:
          - '*'
        allowedMethods:
          - GET
          - POST
          - PUT
          - PATCH
          - DELETE

package:
  individually: true
  patterns:
    - dist/**
    - '!node_modules/**'
```

**Deploy:**

```bash
npm run build
serverless deploy
```

### Terraform

Infrastructure as code with Terraform:

```hcl
# main.tf
resource "aws_lambda_function" "api" {
  filename         = "dist/api.zip"
  function_name    = "glasswork-api"
  role            = aws_iam_role.lambda_role.arn
  handler         = "api.handler"
  runtime         = "nodejs22.x"
  architectures    = ["arm64"]  # Graviton2: Better price/performance
  memory_size     = 256
  timeout         = 10
  source_code_hash = filebase64sha256("dist/api.zip")

  environment {
    variables = {
      NODE_OPTIONS  = "--max-old-space-size=256"
      DATABASE_URL  = var.database_url
    }
  }
}

resource "aws_lambda_function_url" "api_url" {
  function_name      = aws_lambda_function.api.function_name
  authorization_type = "NONE"

  cors {
    allow_origins = ["https://example.com"]
    allow_methods = ["GET", "POST", "PUT", "PATCH", "DELETE"]
    allow_headers = ["*"]
  }
}

output "api_url" {
  value = aws_lambda_function_url.api_url.function_url
}
```

**Deploy:**

```bash
npm run build
zip -r dist/api.zip dist/api.mjs
terraform apply
```

## CloudFront Integration

For production, place Lambda behind CloudFront for:

- Custom domains
- Caching
- WAF protection
- Global edge locations

Add a distribution in your CDK stack using the `functionUrl` created above:

```typescript
import {
  AllowedMethods,
  CachePolicy,
  Distribution,
  OriginRequestPolicy,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { FunctionUrlOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';

const distribution = new Distribution(this, 'ApiDistribution', {
  defaultBehavior: {
    origin: new FunctionUrlOrigin(functionUrl),
    viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    allowedMethods: AllowedMethods.ALLOW_ALL,
    cachePolicy: CachePolicy.CACHING_DISABLED,
    originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
  },
});
new CfnOutput(this, 'CloudFrontUrl', { value: `https://${distribution.distributionDomainName}` });
```

This example uses the public Function URL. Configure a certificate and domain
names for a custom domain, and `webAclId` for an existing WAF web ACL.

## Environment Variables

Pass configuration through environment variables:

```typescript
// Inside the CDK stack constructor, using the existing apiFunction.
apiFunction.addEnvironment('NODE_ENV', 'production');
apiFunction.addEnvironment('PUBLIC_APP_URL', 'https://example.com');
```

Access in your application:

```typescript
import { createConfig, envProvider } from 'glasswork/core';

const config = await createConfig({
  schema: ConfigSchema,
  providers: [envProvider()],
});
```

::: tip Alternative: SSM Parameter Store
Instead of environment variables, use the `ssmProvider` to load configuration from AWS Systems Manager Parameter Store. This is especially useful for sensitive values or when you want centralized configuration management.

See the [Environment Config - AWS SSM Provider](/configuration/environment-config#aws-ssm-parameter-store) for details.
:::

## Performance Optimization

### Memory Configuration

Lambda bills by GB-second. Test different memory sizes:

- **256MB**: Good for simple APIs (< 100 req/s)
- **512MB**: Better for database queries
- **1024MB**: High throughput, complex operations

Higher memory = more CPU, often **cheaper** due to faster execution.

### Cold Start Optimization

**Glasswork is already optimized:**

- Small bundle size (< 1MB)
- Lazy loading with tree shaking
- Minimal dependencies
- PROXY mode DI (no reflection)

**Additional optimizations:**

- Provisioned concurrency (for critical paths)
- Lambda SnapStart (Node.js 20+)
- Connection pooling (see Prisma section)

## Database Connections

### Prisma with Lambda

Use Prisma Data Proxy or connection pooling:

```typescript
// src/database/prisma.service.ts
import { PrismaClient } from '@prisma/client';

export class PrismaService extends PrismaClient {
  constructor() {
    super({
      datasourceUrl: process.env.DATABASE_URL,
    });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

**Connection pooling** (using Prisma Accelerate or PgBouncer):

```bash
DATABASE_URL="postgresql://user:pass@host:5432/db?pgbouncer=true&connection_limit=1"
```

### Connection Limits

Lambda can scale to thousands of concurrent instances. Limit connections:

```typescript
const prisma = new PrismaClient({
  datasourceUrl: process.env.DATABASE_URL,
  // Lambda: 1 connection per instance
  // RDS Proxy handles pooling
});
```

## Monitoring

### CloudWatch Logs

Lambda automatically logs to CloudWatch:

```typescript
import { createLogger } from 'glasswork/core';

const logger = createLogger('UserService');

logger.info('User created', { userId: user.id });
logger.error('Failed to create user', error);
```

### Metrics

Track cold starts, duration, and errors in CloudWatch:

```typescript
import { Duration } from 'aws-cdk-lib';
import { ComparisonOperator, TreatMissingData } from 'aws-cdk-lib/aws-cloudwatch';

apiFunction
  .metricErrors({ period: Duration.minutes(5), statistic: 'Sum' })
  .createAlarm(this, 'ApiErrors', {
    threshold: 5,
    evaluationPeriods: 2,
    comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  });
```

For X-Ray, set `tracing: Tracing.ACTIVE` when constructing the function
(`Tracing` is exported by `aws-cdk-lib/aws-lambda`). For automatic instrumentation,
see [CloudWatch Application Signals](/observability/cloudwatch-application-signals).

## Testing Lambda

Run the application locally with `npm run dev`, `pnpm dev`, or `yarn dev`; the
entry point at the start of this guide starts the HTTP server outside Lambda.
Use application and handler tests for behavior, then synthesize the CDK stack
before deployment:

```bash
npx cdk synth
npx cdk diff
```

For runtime emulation, use the [Lambda Runtime Interface Emulator](https://docs.aws.amazon.com/lambda/latest/dg/images-test.html)
with a Lambda container image. Infrastructure synthesis and a local HTTP server
do not emulate IAM, event source mappings, or Lambda's runtime environment.

## Troubleshooting

### Bundle Too Large

Check what's included:

```typescript
const result = await esbuild.build({
  metafile: true,
  // ...
});

console.log(await analyzeMetafile(result.metafile));
```

Common culprits:

- Prisma client (~800KB) - expected
- Multiple Valibot imports - use single import
- Unused dependencies - check tree shaking

### Cold Starts

Profile with CloudWatch Insights:

```sql
fields @timestamp, @duration
| filter @type = "REPORT"
| stats avg(@duration), max(@duration), min(@duration)
```

### Memory Issues

Increase memory by setting `memorySize: 512` in the CDK `NodejsFunction` options,
or optimize the application.

Monitor with:

```sql
fields @timestamp, @maxMemoryUsed / 1000000 as maxMemoryUsedMB
| filter @type = "REPORT"
| stats avg(maxMemoryUsedMB), max(maxMemoryUsedMB)
```

## Learn More

- [AWS Lambda Documentation](https://docs.aws.amazon.com/lambda/) - Official AWS Lambda docs
- [Hono AWS Lambda Adapter](https://hono.dev/docs/getting-started/aws-lambda) - Lambda integration
- [esbuild Documentation](https://esbuild.github.io/) - Build tool
- [Prisma Data Proxy](https://www.prisma.io/docs/data-platform/data-proxy) - Connection pooling
