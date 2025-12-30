# AWS Setup Guide

This guide covers setting up AWS SES and SNS for production email sending with delivery tracking using AWS SAM.

## Prerequisites

- AWS Account with appropriate IAM permissions
- Domain verified in SES (for production sending)
- AWS SAM CLI installed

## Complete SAM Template

This template sets up everything needed for email sending with delivery tracking. It uses a single SNS topic for all SES events, which simplifies the architecture since the webhook handler routes events by type.

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31
Description: Email infrastructure with SES delivery tracking

Parameters:
  Environment:
    Type: String
    Default: production
    AllowedValues: [development, staging, production]

  EmailDomain:
    Type: String
    Description: Domain for sending emails (must be verified in SES)

  DefaultFromEmail:
    Type: String
    Description: Default sender email address

Resources:
  # ===================
  # SES Configuration
  # ===================

  # Configuration set for delivery tracking
  SESConfigurationSet:
    Type: AWS::SES::ConfigurationSet
    Properties:
      Name: !Sub ${AWS::StackName}-emails

  # ===================
  # SNS Topic (Single topic for all events)
  # ===================

  EmailEventsTopic:
    Type: AWS::SNS::Topic
    Properties:
      TopicName: !Sub ${AWS::StackName}-email-events

  # ===================
  # SES Event Destination
  # ===================

  # Single event destination that sends all event types to one topic
  EmailEventsDestination:
    Type: AWS::SES::ConfigurationSetEventDestination
    Properties:
      ConfigurationSetName: !Ref SESConfigurationSet
      EventDestination:
        Name: all-events
        Enabled: true
        MatchingEventTypes:
          - send
          - delivery
          - bounce
          - complaint
        SnsDestination:
          TopicARN: !Ref EmailEventsTopic

  # ===================
  # Application Lambda
  # ===================

  ApplicationFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: !Sub ${AWS::StackName}-api
      Handler: index.handler
      Runtime: nodejs22.x
      CodeUri: ./dist
      Timeout: 30
      MemorySize: 512
      Environment:
        Variables:
          SES_CONFIGURATION_SET: !Ref SESConfigurationSet
          EMAIL_FROM: !Ref DefaultFromEmail
          NODE_ENV: !Ref Environment
      Policies:
        - Version: '2012-10-17'
          Statement:
            - Effect: Allow
              Action:
                - ses:SendEmail
                - ses:SendRawEmail
              Resource:
                - !Sub "arn:aws:ses:${AWS::Region}:${AWS::AccountId}:identity/${EmailDomain}"
                - !Sub "arn:aws:ses:${AWS::Region}:${AWS::AccountId}:configuration-set/${SESConfigurationSet}"
      FunctionUrlConfig:
        AuthType: NONE
      Events:
        Api:
          Type: Api
          Properties:
            Path: /{proxy+}
            Method: ANY

  # SNS Subscription to webhook endpoint
  EmailEventsSubscription:
    Type: AWS::SNS::Subscription
    Properties:
      TopicArn: !Ref EmailEventsTopic
      Protocol: https
      Endpoint: !Sub
        - '${FunctionUrl}api/email/webhook/sns'
        - FunctionUrl: !GetAtt ApplicationFunctionUrl.FunctionUrl

  # ===================
  # CloudWatch Alarms
  # ===================

  HighBounceRateAlarm:
    Type: AWS::CloudWatch::Alarm
    Properties:
      AlarmName: !Sub ${AWS::StackName}-high-bounce-rate
      AlarmDescription: SES bounce rate exceeds 5%
      MetricName: Reputation.BounceRate
      Namespace: AWS/SES
      Statistic: Average
      Period: 3600
      EvaluationPeriods: 1
      Threshold: 0.05
      ComparisonOperator: GreaterThanThreshold

  HighComplaintRateAlarm:
    Type: AWS::CloudWatch::Alarm
    Properties:
      AlarmName: !Sub ${AWS::StackName}-high-complaint-rate
      AlarmDescription: SES complaint rate exceeds 0.1%
      MetricName: Reputation.ComplaintRate
      Namespace: AWS/SES
      Statistic: Average
      Period: 3600
      EvaluationPeriods: 1
      Threshold: 0.001
      ComparisonOperator: GreaterThanThreshold

Outputs:
  ApiEndpoint:
    Description: API Gateway endpoint URL
    Value: !Sub "https://${ServerlessRestApi}.execute-api.${AWS::Region}.amazonaws.com/Prod"

  WebhookEndpoint:
    Description: SES webhook endpoint URL
    Value: !Sub
      - '${FunctionUrl}api/email/webhook/sns'
      - FunctionUrl: !GetAtt ApplicationFunctionUrl.FunctionUrl

  ConfigurationSetName:
    Description: SES Configuration Set name
    Value: !Ref SESConfigurationSet
```

## Domain Verification

Before sending emails, verify your domain in SES. Add this to your SAM template:

```yaml
Resources:
  # Domain identity for SES
  EmailIdentity:
    Type: AWS::SES::EmailIdentity
    Properties:
      EmailIdentity: !Ref EmailDomain
      DkimAttributes:
        SigningEnabled: true
```

After deployment, add the DNS records output by CloudFormation to your domain's DNS configuration.

## Webhook Handler Implementation

Create the webhook handler using Glasswork's `createSESWebhookHandler`:

```typescript
// src/email/email.module.ts
import { defineModule, createSESWebhookHandler, TemplatedEmailService, SESTransport } from 'glasswork';
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
    const { prismaService } = deps;

    router.post(
      '/webhook/sns',
      ...route({
        tags: ['Email'],
        summary: 'Handle SES notification via SNS',
        operationId: 'handleSesWebhook',
        public: true,
        responses: { 200: undefined },
        handler: createSESWebhookHandler({
          // Signature verification is enabled by default in production
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

## Deployment

Deploy using SAM:

```bash
sam build
sam deploy --guided
```

For subsequent deployments:

```bash
sam build && sam deploy
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
