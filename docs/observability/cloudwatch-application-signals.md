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

The new [ADOT Lambda layers](https://aws-otel.github.io/docs/getting-started/lambda) provide plug-and-play instrumentation with Application Signals enabled by default.

### SAM (AWS Serverless Application Model)

```yaml
ApiFunction:
  Type: AWS::Serverless::Function
  Properties:
    Handler: index.handler
    Runtime: nodejs22.x
    Architectures:
      - arm64
    Environment:
      Variables:
        AWS_LAMBDA_EXEC_WRAPPER: /opt/otel-instrument
    Layers:
      # ADOT Layer for Node.js - check for latest version:
      # https://aws-otel.github.io/docs/getting-started/lambda
      - !Sub 'arn:aws:lambda:${AWS::Region}:615299751070:layer:AWSOpenTelemetryDistroJs:6'
    Policies:
      # Add Application Signals permissions
      - arn:aws:iam::aws:policy/CloudWatchLambdaApplicationSignalsExecutionRolePolicy
```

### CloudFormation (without SAM)

```yaml
ApiFunction:
  Type: AWS::Lambda::Function
  Properties:
    FunctionName: my-api
    Runtime: nodejs22.x
    Architectures:
      - arm64
    Handler: index.handler
    Environment:
      Variables:
        AWS_LAMBDA_EXEC_WRAPPER: /opt/otel-instrument
    Layers:
      - !Sub 'arn:aws:lambda:${AWS::Region}:615299751070:layer:AWSOpenTelemetryDistroJs:6'
    Role: !GetAtt LambdaRole.Arn

LambdaRole:
  Type: AWS::IAM::Role
  Properties:
    AssumeRolePolicyDocument:
      Version: '2012-10-17'
      Statement:
        - Effect: Allow
          Principal:
            Service: lambda.amazonaws.com
          Action: sts:AssumeRole
    ManagedPolicyArns:
      - arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
      - arn:aws:iam::aws:policy/CloudWatchLambdaApplicationSignalsExecutionRolePolicy
```

### AWS CDK

```typescript
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';

const fn = new lambda.Function(this, 'ApiFunction', {
  runtime: lambda.Runtime.NODEJS_22_X,
  architecture: lambda.Architecture.ARM_64,
  handler: 'index.handler',
  code: lambda.Code.fromAsset('dist'),
  environment: {
    AWS_LAMBDA_EXEC_WRAPPER: '/opt/otel-instrument',
  },
  layers: [
    // ADOT layer - check for latest version
    lambda.LayerVersion.fromLayerVersionArn(
      this,
      'AdotLayer',
      `arn:aws:lambda:${this.region}:615299751070:layer:AWSOpenTelemetryDistroJs:6`
    ),
  ],
});

// Add Application Signals permissions
fn.role?.addManagedPolicy(
  iam.ManagedPolicy.fromAwsManagedPolicyName(
    'CloudWatchLambdaApplicationSignalsExecutionRolePolicy'
  )
);
```

### SST (Serverless Stack)

```typescript
new Function(stack, 'api', {
  handler: 'src/lambda.handler',
  runtime: 'nodejs22.x',
  architecture: 'arm64',
  layers: [
    // ADOT layer - check for latest version
    `arn:aws:lambda:${stack.region}:615299751070:layer:AWSOpenTelemetryDistroJs:6`,
  ],
  environment: {
    AWS_LAMBDA_EXEC_WRAPPER: '/opt/otel-instrument',
  },
  permissions: ['cloudwatch', 'xray'],
});
```

## Layer ARNs by Region

The ADOT Lambda layers are available in all AWS regions. For the latest ARNs, see the [official documentation](https://aws-otel.github.io/docs/getting-started/lambda).

Common regions (Node.js):

| Region | Layer ARN |
|--------|-----------|
| us-east-1 | `arn:aws:lambda:us-east-1:615299751070:layer:AWSOpenTelemetryDistroJs:6` |
| us-west-2 | `arn:aws:lambda:us-west-2:615299751070:layer:AWSOpenTelemetryDistroJs:6` |
| eu-west-1 | `arn:aws:lambda:eu-west-1:615299751070:layer:AWSOpenTelemetryDistroJs:6` |
| eu-central-1 | `arn:aws:lambda:eu-central-1:615299751070:layer:AWSOpenTelemetryDistroJs:6` |
| ap-northeast-1 | `arn:aws:lambda:ap-northeast-1:615299751070:layer:AWSOpenTelemetryDistroJs:6` |

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

```yaml
Environment:
  Variables:
    AWS_LAMBDA_EXEC_WRAPPER: /opt/otel-instrument
    OTEL_AWS_APPLICATION_SIGNALS_ENABLED: 'false'
```

### Custom Sampling Rate

By default, sampling is parent-based. To set a custom rate (e.g., 30%):

```yaml
Environment:
  Variables:
    OTEL_TRACES_SAMPLER: traceidratio
    OTEL_TRACES_SAMPLER_ARG: '0.3'
```

### Custom Environment Name

```yaml
Environment:
  Variables:
    LAMBDA_APPLICATION_SIGNALS_REMOTE_ENVIRONMENT: 'lambda:production'
```

## Required IAM Permissions

Use the AWS managed policy for simplest setup:

```yaml
ManagedPolicyArns:
  - arn:aws:iam::aws:policy/CloudWatchLambdaApplicationSignalsExecutionRolePolicy
```

Or define permissions explicitly:

```yaml
- Effect: Allow
  Action:
    - xray:PutTraceSegments
    - xray:PutTelemetryRecords
    - cloudwatch:PutMetricData
    - logs:CreateLogDelivery
    - logs:GetLogDelivery
    - logs:UpdateLogDelivery
    - logs:DeleteLogDelivery
    - logs:ListLogDeliveries
    - logs:PutResourcePolicy
    - logs:DescribeResourcePolicies
    - logs:DescribeLogGroups
  Resource: '*'
```

## Viewing Application Signals

1. Open **AWS Console** → **CloudWatch** → **Application Signals**
2. Select your service
3. View:
   - **Service Map** - Dependencies
   - **Metrics** - Latency, errors, requests
   - **Traces** - End-to-end request flows

## Adding SLOs

### Availability SLO (99.9%)

```yaml
AvailabilitySLO:
  Type: AWS::CloudWatch::ServiceLevelObjective
  Properties:
    Name: my-api-availability
    Description: 99.9% availability
    Sli:
      SliMetric:
        MetricDataQueries:
          - Id: success
            MetricStat:
              Metric:
                Namespace: AWS/Lambda
                MetricName: Invocations
                Dimensions:
                  - Name: FunctionName
                    Value: my-api
              Period: 60
              Stat: Sum
          - Id: errors
            MetricStat:
              Metric:
                Namespace: AWS/Lambda
                MetricName: Errors
                Dimensions:
                  - Name: FunctionName
                    Value: my-api
              Period: 60
              Stat: Sum
          - Id: availability
            Expression: '(success - errors) / success * 100'
    Goal:
      AttainmentGoal: 99.9
      WarningThreshold: 99.5
```

### Latency SLO (P95 < 1000ms)

```yaml
LatencySLO:
  Type: AWS::CloudWatch::ServiceLevelObjective
  Properties:
    Name: my-api-latency
    Description: P95 latency under 1000ms
    Sli:
      SliMetric:
        MetricDataQueries:
          - Id: latency
            MetricStat:
              Metric:
                Namespace: AWS/Lambda
                MetricName: Duration
                Dimensions:
                  - Name: FunctionName
                    Value: my-api
              Period: 60
              Stat: p95
    Goal:
      AttainmentGoal: 1000
      ComparisonOperator: LessThanThreshold
```

## CloudWatch Alarms

```yaml
HighErrorRateAlarm:
  Type: AWS::CloudWatch::Alarm
  Properties:
    AlarmName: my-api-high-error-rate
    MetricName: Errors
    Namespace: AWS/Lambda
    Statistic: Sum
    Period: 300
    EvaluationPeriods: 2
    Threshold: 5
    ComparisonOperator: GreaterThanThreshold
    Dimensions:
      - Name: FunctionName
        Value: my-api
    TreatMissingData: notBreaching

HighLatencyAlarm:
  Type: AWS::CloudWatch::Alarm
  Properties:
    AlarmName: my-api-high-latency
    MetricName: Duration
    Namespace: AWS/Lambda
    ExtendedStatistic: p95
    Period: 300
    EvaluationPeriods: 2
    Threshold: 1000
    ComparisonOperator: GreaterThanThreshold
    Dimensions:
      - Name: FunctionName
        Value: my-api
```

## Combining with Glasswork Observability

Application Signals complements Glasswork's built-in observability:

```typescript
import pino from 'pino';
import { bootstrap, createCloudWatchTracker, lambdaPinoConfig } from 'glasswork';

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
