---
description: AWS CloudWatch Application Signals for native APM on Lambda with automatic OpenTelemetry instrumentation and service dependency maps.
---

# CloudWatch Application Signals

[AWS CloudWatch Application Signals](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-Application-Signals.html) provides native APM for Lambda with automatic instrumentation via the AWS Distro for OpenTelemetry (ADOT).

::: tip When to Use
Application Signals adds AWS-native APM on top of basic observability features. Use it when you need:

- Service dependency maps
- Automatic request tracing
- SLO tracking and alerting
- No third-party monitoring costs
:::

## Overview

Application Signals provides:

- **Service Maps** - Visualize service dependencies
- **Request Traces** - End-to-end tracking via X-Ray
- **Metrics** - Latency, error rate, throughput
- **SLOs** - Service Level Objectives with alerts

## Quick Setup

Use CDK to attach the AWS Lambda Layer for OpenTelemetry to the existing
`apiFunction` from [Lambda Deployment](/deployment/lambda#aws-cdk). Select the
layer ARN for your deployment region, Node.js runtime, and architecture from the
[ADOT documentation](https://aws-otel.github.io/docs/getting-started/lambda).
Pin that ARN in deployment configuration instead of copying a potentially stale
layer version from an example.

```typescript
import { CfnParameter } from 'aws-cdk-lib';
import { CfnDiscovery } from 'aws-cdk-lib/aws-applicationsignals';
import { ManagedPolicy } from 'aws-cdk-lib/aws-iam';
import { LayerVersion } from 'aws-cdk-lib/aws-lambda';

// Create once per account/region, or enable discovery through the AWS console.
new CfnDiscovery(this, 'ApplicationSignalsDiscovery');

const adotLayerArn = new CfnParameter(this, 'AdotLayerArn', {
  type: 'String',
  description: 'Regional OpenTelemetry layer ARN for this runtime and architecture',
});
apiFunction.addLayers(
  LayerVersion.fromLayerVersionArn(this, 'AdotLayer', adotLayerArn.valueAsString)
);
apiFunction.addEnvironment('AWS_LAMBDA_EXEC_WRAPPER', '/opt/otel-instrument');
apiFunction.role?.addManagedPolicy(
  ManagedPolicy.fromAwsManagedPolicyName('CloudWatchLambdaApplicationSignalsExecutionRolePolicy')
);
```

Supply the selected ARN when deploying:

```bash
npx cdk deploy --parameters AdotLayerArn="$ADOT_LAYER_ARN"
```

Application Signals discovery must be enabled before services can be discovered.
Do not create a second discovery resource if the account/region is already
managed elsewhere. See the [AWS CDK setup instructions](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-Application-Signals-Enable-LambdaMain.html).

::: warning ESM and ADOT Compatibility
The ADOT layer wraps your handler at runtime. With ESM bundles, the ES6 `export` is immutable which can prevent ADOT from patching it.

**Try ESM first** - newer ADOT versions have improved ESM support. If Application Signals isn't detecting your function, you have options:

**Option 1: Use CJS format (if your codebase allows)**

This only works if your code doesn't use ESM-only features:

- No top-level `await`
- No `import.meta.url` (Prisma generates this)

```typescript
// build.ts
const sharedConfig: esbuild.BuildOptions = {
  format: 'cjs',
  outfile: 'dist/api.js',
};
```

**Option 2: Keep ESM and monitor AWS updates**

AWS is actively improving ADOT ESM support. ESM bundles still get basic OpenTelemetry tracing, just potentially missing some Application Signals features.

```typescript
// build.ts - ESM with require shim for CJS dependencies
const sharedConfig: esbuild.BuildOptions = {
  format: 'esm',
  outfile: 'dist/api.mjs',
  banner: {
    js: `import { createRequire } from 'module'; const require = createRequire(import.meta.url);`,
  },
};
```

:::

## Configuration Options

### Disable Application Signals

Application Signals is enabled by default. To disable it and keep only OpenTelemetry tracing:

```typescript
apiFunction.addEnvironment('OTEL_AWS_APPLICATION_SIGNALS_ENABLED', 'false');
```

### Custom Sampling Rate

By default, sampling is parent-based. To set a custom rate (e.g., 30%):

```typescript
apiFunction.addEnvironment('OTEL_TRACES_SAMPLER', 'traceidratio');
apiFunction.addEnvironment('OTEL_TRACES_SAMPLER_ARG', '0.3');
```

### Custom Environment Name

```typescript
apiFunction.addEnvironment('LAMBDA_APPLICATION_SIGNALS_REMOTE_ENVIRONMENT', 'lambda:production');
```

### Set Service Version

ADOT tries to extract version information from your deployment package. If it fails, you'll see a warning. Set the version explicitly:

```typescript
// Supply the release version from package.json or your deployment pipeline.
apiFunction.addEnvironment('OTEL_SERVICE_VERSION', '1.0.0');
```

### Reduce Log Verbosity

By default, ADOT logs informational messages during initialization. To reduce log noise in CloudWatch:

```typescript
apiFunction.addEnvironment('OTEL_LOG_LEVEL', 'error');
```

**Note:** Some warnings (like experimental loader warnings) come from Node.js itself and cannot be suppressed. Setting `OTEL_LOG_LEVEL=error` significantly reduces ADOT-related log noise while keeping error visibility.

## Required IAM Permissions

Use the AWS managed policy for simplest setup:

```typescript
import { ManagedPolicy } from 'aws-cdk-lib/aws-iam';

apiFunction.role?.addManagedPolicy(
  ManagedPolicy.fromAwsManagedPolicyName('CloudWatchLambdaApplicationSignalsExecutionRolePolicy')
);
```

Or define permissions explicitly:

```typescript
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';

apiFunction.addToRolePolicy(
  new PolicyStatement({
    actions: [
      'xray:PutTraceSegments',
      'xray:PutTelemetryRecords',
      'cloudwatch:PutMetricData',
      'logs:CreateLogDelivery',
      'logs:GetLogDelivery',
      'logs:UpdateLogDelivery',
      'logs:DeleteLogDelivery',
      'logs:ListLogDeliveries',
      'logs:PutResourcePolicy',
      'logs:DescribeResourcePolicies',
      'logs:DescribeLogGroups',
    ],
    resources: ['*'],
  })
);
```

## Viewing Application Signals

1. Open **AWS Console** → **CloudWatch** → **Application Signals**
2. Select your service
3. View:
   - **Service Map** - Dependencies
   - **Metrics** - Latency, errors, requests
   - **Traces** - End-to-end request flows

## Adding SLOs

CDK exposes service-level objectives through `aws-applicationsignals`. These
examples use Lambda metrics for the existing `apiFunction`. They are
**period-based** SLOs: the goal is the percentage of healthy one-minute periods
in a rolling 30-day interval, rather than the percentage of individual requests.
Lambda invocation success is not the same as HTTP availability; use application
or Application Signals metrics when you need an HTTP-level SLI.

### Availability SLO

A healthy period has at least 99.9% successful Lambda invocations. The goal is
that 99.9% of measured periods are healthy:

```typescript
import { CfnServiceLevelObjective } from 'aws-cdk-lib/aws-applicationsignals';

new CfnServiceLevelObjective(this, 'AvailabilitySLO', {
  name: 'my-api-availability',
  description: '99.9% invocation availability in 99.9% of measured periods',
  sli: {
    comparisonOperator: 'GreaterThanOrEqualTo',
    metricThreshold: 99.9,
    sliMetric: {
      metricDataQueries: [
        {
          id: 'invocations',
          returnData: false,
          metricStat: {
            metric: {
              namespace: 'AWS/Lambda',
              metricName: 'Invocations',
              dimensions: [{ name: 'FunctionName', value: apiFunction.functionName }],
            },
            period: 60,
            stat: 'Sum',
          },
        },
        {
          id: 'errors',
          returnData: false,
          metricStat: {
            metric: {
              namespace: 'AWS/Lambda',
              metricName: 'Errors',
              dimensions: [{ name: 'FunctionName', value: apiFunction.functionName }],
            },
            period: 60,
            stat: 'Sum',
          },
        },
        {
          id: 'availability',
          returnData: true,
          expression: '100 * (invocations - FILL(errors, 0)) / invocations',
        },
      ],
    },
  },
  goal: {
    attainmentGoal: 99.9,
    warningThreshold: 50, // Warn when 50% of the error budget remains.
    interval: { rollingInterval: { duration: 30, durationUnit: 'DAY' } },
  },
});
```

Periods with no invocations do not produce an availability ratio. Account for
idle periods and expected traffic when choosing your SLI and alert thresholds.

### Latency SLO (p95 < 1000 ms)

A healthy period has Lambda duration p95 below 1000 ms. The attainment goal is
99.9%, not a duration threshold:

```typescript
import { CfnServiceLevelObjective } from 'aws-cdk-lib/aws-applicationsignals';

new CfnServiceLevelObjective(this, 'LatencySLO', {
  name: 'my-api-latency',
  description: 'Duration p95 below 1000 ms in 99.9% of measured periods',
  sli: {
    comparisonOperator: 'LessThan',
    metricThreshold: 1000,
    sliMetric: {
      metricDataQueries: [
        {
          id: 'latency',
          returnData: true,
          metricStat: {
            metric: {
              namespace: 'AWS/Lambda',
              metricName: 'Duration',
              dimensions: [{ name: 'FunctionName', value: apiFunction.functionName }],
            },
            period: 60,
            stat: 'p95',
          },
        },
      ],
    },
  },
  goal: {
    attainmentGoal: 99.9,
    interval: { rollingInterval: { duration: 30, durationUnit: 'DAY' } },
  },
});
```

See the [CDK service-level objective reference](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_applicationsignals.CfnServiceLevelObjective.html)
for Application Signals SLIs and request-based SLOs.

## CloudWatch Alarms

Use CDK's Lambda metric helpers so the function dimension follows its actual
name. These are an error-count alarm and a duration alarm, independent of the SLOs:

```typescript
import { Duration } from 'aws-cdk-lib';
import { ComparisonOperator, TreatMissingData } from 'aws-cdk-lib/aws-cloudwatch';

apiFunction
  .metricErrors({ period: Duration.minutes(5), statistic: 'Sum' })
  .createAlarm(this, 'HighErrorCount', {
    threshold: 5,
    evaluationPeriods: 2,
    comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  });
apiFunction
  .metricDuration({ period: Duration.minutes(5), statistic: 'p95' })
  .createAlarm(this, 'HighLatency', {
    threshold: 1000,
    evaluationPeriods: 2,
    comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  });
```

## Combining with Glasswork Observability

Application Signals complements Glasswork's built-in observability:

```typescript
import pino from 'pino';
import { bootstrap } from 'glasswork/core';
import { createCloudWatchTracker, lambdaPinoConfig } from 'glasswork/observability';

const { app } = await bootstrap(AppModule, {
  // Structured logging → CloudWatch Logs Insights
  logger: { pino: pino(lambdaPinoConfig) },

  // Exception tracking → CloudWatch Metrics
  exceptionTracking: {
    tracker: createCloudWatchTracker({ namespace: 'MyApp/Errors' }),
  },
});

// + Application Signals (via Lambda layer) → APM + Tracing
```

## Learn More

- [AWS ADOT Lambda Documentation](https://aws-otel.github.io/docs/getting-started/lambda) - Official ADOT setup guide
- [CloudWatch Application Signals](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-Application-Signals.html) - AWS documentation
- [Lambda Application Signals](https://docs.aws.amazon.com/lambda/latest/dg/monitoring-application-signals.html) - Lambda-specific setup
