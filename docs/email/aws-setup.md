---
description: AWS CDK setup for SES emails, domain verification, SNS delivery tracking, IAM permissions, and reputation alarms.
---

# AWS Setup Guide

This guide uses AWS CDK v2 in TypeScript to configure SES and SNS for production
email sending with delivery tracking. See [Lambda Deployment](/deployment/lambda#aws-cdk)
for CDK installation and the app entry point.

## Prerequisites

- An AWS account with deployment permissions
- A domain whose DNS records you can manage
- SES production access in the deployment region for unrestricted recipients
- An application with the webhook handler below mounted at `/api/email/webhook/sns`

## Complete CDK Stack

One SNS topic receives all SES events; the webhook routes them by type. CDK
creates the topic policy allowing SES to publish and grants the application
permission to send email using the identity and configuration set.

```typescript
// lib/email-stack.ts
import { ArnFormat, CfnOutput, Duration, Stack, type StackProps } from 'aws-cdk-lib';
import { ComparisonOperator, Metric, TreatMissingData } from 'aws-cdk-lib/aws-cloudwatch';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Architecture, FunctionUrlAuthType, Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import {
  ConfigurationSet,
  EmailIdentity,
  EmailSendingEvent,
  EventDestination,
  Identity,
} from 'aws-cdk-lib/aws-ses';
import { SubscriptionProtocol, Topic } from 'aws-cdk-lib/aws-sns';
import { UrlSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';
import type { Construct } from 'constructs';

interface EmailStackProps extends StackProps {
  emailDomain: string;
  fromEmail: string;
}

export class EmailStack extends Stack {
  constructor(scope: Construct, id: string, props: EmailStackProps) {
    super(scope, id, props);

    const configurationSet = new ConfigurationSet(this, 'EmailConfigurationSet');
    const identity = new EmailIdentity(this, 'EmailIdentity', {
      identity: Identity.domain(props.emailDomain),
      configurationSet,
    });
    const eventsTopic = new Topic(this, 'EmailEvents');
    configurationSet.addEventDestination('AllEvents', {
      destination: EventDestination.snsTopic(eventsTopic),
      events: [
        EmailSendingEvent.SEND,
        EmailSendingEvent.DELIVERY,
        EmailSendingEvent.BOUNCE,
        EmailSendingEvent.COMPLAINT,
      ],
    });

    const apiFunction = new NodejsFunction(this, 'ApiFunction', {
      entry: 'src/server.ts',
      handler: 'handler',
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.seconds(30),
      memorySize: 512,
      bundling: {
        format: OutputFormat.ESM,
        target: 'node24',
        minify: true,
        keepNames: true,
        externalModules: ['@aws-sdk/*'],
        banner:
          "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
      },
      environment: {
        NODE_ENV: 'production',
        SES_CONFIGURATION_SET: configurationSet.configurationSetName,
        SNS_TOPIC_ARN: eventsTopic.topicArn,
        EMAIL_FROM: props.fromEmail,
      },
    });
    apiFunction.addToRolePolicy(
      new PolicyStatement({
        actions: ['ses:SendEmail', 'ses:SendRawEmail'],
        resources: [
          identity.emailIdentityArn,
          this.formatArn({
            service: 'ses',
            resource: 'configuration-set',
            resourceName: configurationSet.configurationSetName,
            arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
          }),
        ],
      })
    );
    const functionUrl = apiFunction.addFunctionUrl({ authType: FunctionUrlAuthType.NONE });
    const webhookUrl = `${functionUrl.url}api/email/webhook/sns`;
    eventsTopic.addSubscription(
      new UrlSubscription(webhookUrl, {
        protocol: SubscriptionProtocol.HTTPS,
      })
    );

    new Metric({
      namespace: 'AWS/SES',
      metricName: 'Reputation.BounceRate',
      statistic: 'Average',
      period: Duration.hours(1),
    }).createAlarm(this, 'HighBounceRate', {
      threshold: 0.05,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });
    new Metric({
      namespace: 'AWS/SES',
      metricName: 'Reputation.ComplaintRate',
      statistic: 'Average',
      period: Duration.hours(1),
    }).createAlarm(this, 'HighComplaintRate', {
      threshold: 0.001,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });

    new CfnOutput(this, 'ApiEndpoint', { value: functionUrl.url });
    new CfnOutput(this, 'WebhookEndpoint', { value: webhookUrl });
    new CfnOutput(this, 'ConfigurationSetName', { value: configurationSet.configurationSetName });
    identity.dkimRecords.forEach((record, index) => {
      new CfnOutput(this, `DkimRecord${index + 1}`, {
        value: `${record.name} CNAME ${record.value}`,
      });
    });
  }
}
```

The Function URL is public so SNS can reach the webhook; Glasswork verifies the
SNS signature and the configured topic allowlist. Keep authentication on other
application routes. Add your application's database and other configuration to
the Lambda environment or configuration providers.

## Domain Verification

`EmailIdentity` creates the SES identity with Easy DKIM enabled. After deployment,
add the stack's `DkimRecord` CNAME outputs to your domain's DNS and wait for SES
verification. The sender address must belong to that identity.

If Route 53 manages your domain, CDK can create the DKIM records automatically.
Replace the identity definition in the stack with:

```typescript
import { HostedZone } from 'aws-cdk-lib/aws-route53';

const zone = HostedZone.fromLookup(this, 'EmailZone', { domainName: props.emailDomain });
const identity = new EmailIdentity(this, 'EmailIdentity', {
  identity: Identity.publicHostedZone(zone),
  configurationSet,
});
```

Use an account and region on the CDK stack for hosted-zone lookups. SES identities
and production access are regional; deploy and send from the same region.

## Webhook Handler Implementation

Create the webhook handler using Glasswork's `createSESWebhookHandler`:

```typescript
// src/email/email.module.ts
import { defineModule } from 'glasswork/core';
import { createSESWebhookHandler, TemplatedEmailService, SESTransport } from 'glasswork/email';
import { templates } from './compiled/index.js';

export const EmailModule = defineModule({
  name: 'email',
  basePath: 'email',
  providers: [
    {
      provide: 'emailService',
      useFactory: ({ config, prismaService }) => {
        const transport = new SESTransport({
          region: config.get('awsRegion'),
          configurationSet: config.get('sesConfigurationSet'),
        });

        return new TemplatedEmailService({
          config: {
            transport,
            from: config.get('emailFrom'),
          },
          templates,
          onSent: async (result, message) => {
            // Track sent emails in database
            await prismaService.email.create({
              data: {
                messageId: result.messageId,
                recipient: Array.isArray(message.to) ? message.to[0] : message.to,
                subject: message.subject,
                status: 'SENT',
              },
            });
          },
        });
      },
    },
  ],
  routes: (router, deps, route) => {
    const { config, prismaService } = deps;

    router.post(
      '/webhook/sns',
      ...route({
        tags: ['Email'],
        summary: 'Handle SES notification via SNS',
        operationId: 'handleSesWebhook',
        public: true,
        responses: { 200: undefined },
        handler: createSESWebhookHandler({
          // Signature verification is enabled by default. The allowlist prevents
          // valid messages from another AWS account or topic being accepted.
          allowedTopicArns: [config.get('snsTopicArn')],
          onDelivered: async (event) => {
            await prismaService.email.update({
              where: { messageId: event.messageId },
              data: {
                status: 'DELIVERED',
                deliveredAt: event.timestamp,
              },
            });
          },
          onBounced: async (event) => {
            await prismaService.email.update({
              where: { messageId: event.messageId },
              data: {
                status: 'BOUNCED',
                bounceType: event.bounceType,
                bounceAt: event.timestamp,
                bounceInfo: event.reason,
              },
            });
          },
          onComplaint: async (event) => {
            await prismaService.email.update({
              where: { messageId: event.messageId },
              data: {
                status: 'COMPLAINED',
                complaintType: event.complaintType,
                complaintAt: event.timestamp,
              },
            });
          },
        }),
      })
    );
  },
});
```

Do not disable signature verification on a network-accessible endpoint. For an
isolated test that supplies synthetic SNS messages, set `verifySignature: false`
explicitly. Automatic subscription confirmation only follows HTTPS URLs on the
AWS SNS hostname for the message's region; redirects are rejected.

## Deployment

Instantiate the stack in your CDK app using your verified domain and sender:

```typescript
// bin/app.ts
import { App } from 'aws-cdk-lib';
import { EmailStack } from '../lib/email-stack';

const app = new App();
new EmailStack(app, 'EmailStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
  emailDomain: 'example.com',
  fromEmail: 'noreply@example.com',
});
```

With the CDK CLI installed and `cdk.json` configured as described in
[Lambda Deployment](/deployment/lambda#aws-cdk):

```bash
npx cdk bootstrap
npx cdk synth
npx cdk deploy
```

For subsequent deployments:

```bash
npx cdk diff
npx cdk deploy
```

## Local Development

For local development, use LocalStack with Docker Compose:

```yaml
# docker-compose.yml
services:
  localstack:
    image: localstack/localstack
    ports:
      - "4566:4566"
    environment:
      - SERVICES=ses,sns,dynamodb
      - DEBUG=1
    volumes:
      - "./localstack:/var/lib/localstack"
```

Configure your transport for LocalStack:

```typescript
const transport = new SESTransport({
  region: 'us-east-1',
  endpoint: process.env.SES_ENDPOINT || undefined, // http://localhost:4566 for local
});
```

## Troubleshooting

### Common Issues

**"Email address is not verified"**

- In sandbox mode, both sender and recipient must be verified
- Request production access via AWS Console

**"Access Denied" when sending**

- Verify IAM permissions include the SES identity and configuration set ARNs
- Ensure the region matches your verified domain

**SNS notifications not arriving**

- Check subscription status in AWS Console (should be "Confirmed")
- Verify webhook endpoint is publicly accessible
- Check CloudWatch Logs for the Lambda function

**Configuration set not found**

- Wait for CloudFormation stack to complete
- Verify stack deployed to the correct region


## Webhook acknowledgements and retries

`createSESWebhookHandler` returns HTTP 200 after the configured callback completes.
Callback failures return HTTP 503; signature and subscription failures retain their
own error status. Persist the event or durably enqueue work before resolving a
callback. A callback that catches and suppresses its own errors is treated as successful.

SNS can deliver the same notification more than once. Make callbacks idempotent,
for example by recording the SNS `MessageId` from `c.get('snsMessage')` in the same
transaction as the application update. Configure a finite delivery retry policy
and an SQS dead-letter queue on the SNS subscription for exhausted deliveries.
See [SNS delivery retries](https://docs.aws.amazon.com/sns/latest/dg/sns-message-delivery-retries.html).

Existing applications that previously relied on callback errors being acknowledged
will now receive retries. Review duplicate handling before deploying this change.
