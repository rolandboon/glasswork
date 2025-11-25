# Lambda Deployment

Glasswork is optimized for AWS Lambda with small bundle sizes, fast cold starts, and native compatibility. This guide covers building and deploying your application to Lambda.

## Lambda-Ready by Default

Glasswork applications are Lambda-ready out of the box:

```typescript
// src/server.ts
import { serve } from '@hono/node-server';
import { bootstrap, isLambda } from 'glasswork';
import { handle } from 'hono/aws-lambda';
import { AppModule } from './app.module.js';

const { app } = bootstrap(AppModule, {
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

## Building for Lambda

### esbuild Configuration

Use esbuild to create optimized Lambda bundles:

```typescript
// build.ts
import * as esbuild from 'esbuild';
import { analyzeMetafile } from 'esbuild';

const sharedConfig: esbuild.BuildOptions = {
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  bundle: true,
  minify: true,
  keepNames: true, // Required for Awilix PROXY mode
  sourcemap: false,
  metafile: true,
  external: ['@aws-sdk/*'], // AWS SDK available in Lambda runtime
  treeShaking: true,
  drop: ['debugger'],
};

async function build() {
  try {
    const result = await esbuild.build({
      ...sharedConfig,
      entryPoints: ['src/server.ts'],
      outfile: 'dist/api.js',
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
- `keepNames: true` - **Critical** for Awilix dependency injection (preserves class/property names)
- `external: ['@aws-sdk/*']` - Excludes AWS SDK (included in Lambda runtime)
- `minify: true` - Reduces bundle size for faster cold starts
- `treeShaking: true` - Removes unused code

**Install esbuild:**
```bash
npm install -D esbuild
```

**Add build script** (`package.json`):
```json
{
  "scripts": {
    "build": "tsx build.ts",
    "build:watch": "tsx build.ts --watch"
  }
}
```

### Bundle Size

Expect bundle sizes under 1MB:
- Glasswork + Hono + Valibot: ~200-300KB
- With Prisma: ~800KB-1MB
- Cold start: 100-300ms

## Deployment Options

Choose the infrastructure-as-code tool that fits your workflow:

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

### AWS CDK

Use TypeScript for infrastructure:

```typescript
// lib/api-stack.ts
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';

export class ApiStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const apiFunction = new lambdaNodejs.NodejsFunction(this, 'ApiFunction', {
      entry: 'src/server.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: cdk.Duration.seconds(10),
      bundling: {
        minify: true,
        sourceMap: false,
        target: 'node22',
        keepNames: true, // Required for Awilix
        externalModules: ['@aws-sdk/*'],
      },
      environment: {
        NODE_OPTIONS: '--max-old-space-size=256',
        DATABASE_URL: process.env.DATABASE_URL!,
      },
    });

    // Add Function URL
    const functionUrl = apiFunction.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: ['https://example.com'],
        allowedMethods: [lambda.HttpMethod.ALL],
        allowedHeaders: ['*'],
      },
    });

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: functionUrl.url,
    });
  }
}
```

**Deploy:**
```bash
cdk deploy
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
zip -r dist/api.zip dist/api.js
terraform apply
```

## CloudFront Integration

For production, place Lambda behind CloudFront for:
- Custom domains
- Caching
- WAF protection
- Global edge locations

**Example CloudFront distribution:**

```yaml
# SAM template.yaml
  CloudFrontDistribution:
    Type: AWS::CloudFront::Distribution
    Properties:
      DistributionConfig:
        Enabled: true
        Origins:
          - Id: ApiOrigin
            DomainName: !Select [2, !Split ['/', !GetAtt ApiFunctionUrl.FunctionUrl]]
            CustomOriginConfig:
              OriginProtocolPolicy: https-only
        DefaultCacheBehavior:
          TargetOriginId: ApiOrigin
          ViewerProtocolPolicy: redirect-to-https
          AllowedMethods: [GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE]
          CachePolicyId: 4135ea2d-6df8-44a3-9df3-4b5a84be39ad # CachingDisabled
          OriginRequestPolicyId: b689b0a8-53d0-40ab-baf2-68738e2966ac # AllViewerExceptHostHeader
```

## Environment Variables

Pass configuration through environment variables:

```yaml
Environment:
  Variables:
    NODE_ENV: production
    DATABASE_URL: !Ref DatabaseUrl
    API_KEY: !Ref ApiKey
    # Add more as needed
```

Access in your application:

```typescript
import { createConfig, envProvider } from 'glasswork';

const config = await createConfig({
  schema: ConfigSchema,
  providers: [envProvider()],
});
```

::: tip Alternative: SSM Parameter Store
Instead of environment variables, use the `ssmProvider` to load configuration from AWS Systems Manager Parameter Store. This is especially useful for sensitive values or when you want centralized configuration management.

See the [Configuration Guide - AWS SSM Provider](/guide/configuration#aws-ssm-parameter-store) for details.
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
import { createLogger } from 'glasswork';

const logger = createLogger('UserService');

logger.info('User created', { userId: user.id });
logger.error('Failed to create user', error);
```

### Metrics

Track cold starts, duration, and errors in CloudWatch:

```yaml
# SAM template.yaml
  ApiFunction:
    Properties:
      # Enable X-Ray tracing
      Tracing: Active
```

## Testing Lambda

Test locally with SAM CLI:

```bash
# Start local API
sam local start-api

# Invoke function
sam local invoke ApiFunction --event event.json
```

Or use the AWS Lambda Runtime Interface Emulator:

```bash
npm install -D @aws-sdk/client-lambda

# Run locally
node --import=@aws-sdk/client-lambda dist/api.js
```

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

Increase memory or optimize:

```yaml
MemorySize: 512 # MB
```

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
