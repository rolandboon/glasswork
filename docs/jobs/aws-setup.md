---
title: AWS Setup
---

# AWS Setup Guide

This guide covers setting up AWS SQS and Lambda for background jobs using AWS SAM.

## Prerequisites

- AWS Account with appropriate IAM permissions
- AWS SAM CLI installed

## Complete SAM Template

This template sets up a standard SQS queue, a Dead Letter Queue (DLQ), and a Worker Lambda function.

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31
Description: Background jobs infrastructure

Parameters:
  Environment:
    Type: String
    Default: production
    AllowedValues: [development, staging, production]

Resources:
  # ===================
  # SQS Queues
  # ===================

  # Dead Letter Queue (DLQ)
  JobQueueDLQ:
    Type: AWS::SQS::Queue
    Properties:
      QueueName: !Sub ${AWS::StackName}-jobs-dlq

  # Main Job Queue
  JobQueue:
    Type: AWS::SQS::Queue
    Properties:
      QueueName: !Sub ${AWS::StackName}-jobs
      VisibilityTimeout: 180 # Must be >= Lambda timeout * 6
      RedrivePolicy:
        deadLetterTargetArn: !GetAtt JobQueueDLQ.Arn
        maxReceiveCount: 3 # Retry 3 times before moving to DLQ

  # ===================
  # Worker Lambda
  # ===================

  WorkerFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: !Sub ${AWS::StackName}-worker
      Handler: worker.handler
      Runtime: nodejs2.x
      CodeUri: ./dist
      Timeout: 30
      MemorySize: 512
      Environment:
        Variables:
          NODE_ENV: !Ref Environment
          JOB_QUEUE_URL: !Ref JobQueue
          AWS_NODEJS_CONNECTION_REUSE_ENABLED: "1"
      Policies:
        - SQSSendMessagePolicy:
            QueueName: !GetAtt JobQueue.QueueName
        - SQSPollerPolicy:
            QueueName: !GetAtt JobQueue.QueueName
      Events:
        SQSEvent:
          Type: SQS
          Properties:
            Queue: !GetAtt JobQueue.Arn
            BatchSize: 10
            # Optional: Limit concurrency to protect downstream resources
            # ScalingConfig:
            #   MaximumConcurrency: 5

Outputs:
  JobQueueUrl:
    Description: URL of the job queue
    Value: !Ref JobQueue
```

## FIFO Queues

If you need strict ordering or exactly-once processing (deduplication), use a FIFO queue.

```yaml
  JobQueueFIFO:
    Type: AWS::SQS::Queue
    Properties:
      QueueName: !Sub ${AWS::StackName}-jobs.fifo
      FifoQueue: true
      ContentBasedDeduplication: false # We provide custom deduplication IDs
      VisibilityTimeout: 180
      RedrivePolicy:
        deadLetterTargetArn: !GetAtt JobQueueDLQFIFO.Arn
        maxReceiveCount: 3

  JobQueueDLQFIFO:
    Type: AWS::SQS::Queue
    Properties:
      QueueName: !Sub ${AWS::StackName}-jobs-dlq.fifo
      FifoQueue: true
```

## Optional DynamoDB Scheduler

Glasswork self-reschedules delays longer than 15 minutes by default (no DynamoDB table needed). If you prefer the DynamoDB strategy (`longDelayStrategy: 'dynamodb'`) you need a table and a Scheduler Lambda.

```yaml
  # Scheduler Table
  ScheduledJobsTable:
    Type: AWS::DynamoDB::Table
    Properties:
      TableName: !Sub ${AWS::StackName}-scheduled-jobs
      BillingMode: PAY_PER_REQUEST
      AttributeDefinitions:
        - AttributeName: pk
          AttributeType: S
        - AttributeName: sk
          AttributeType: S
      KeySchema:
        - AttributeName: pk
          KeyType: HASH
        - AttributeName: sk
          KeyType: RANGE
      TimeToLiveSpecification:
        AttributeName: ttl
        Enabled: true

  # Scheduler Lambda (runs every minute)
  SchedulerFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: scheduler.handler
      # ... other properties ...
      Policies:
        - DynamoDBCrudPolicy:
            TableName: !Ref ScheduledJobsTable
        - SQSSendMessagePolicy:
            QueueName: !GetAtt JobQueue.QueueName
      Events:
        EveryMinute:
          Type: Schedule
          Properties:
            Schedule: rate(1 minute)
```

## Periodic Jobs (EventBridge)

To trigger periodic jobs (cron), use EventBridge Schedules targeting your Worker Lambda.

```yaml
  DailyCleanupSchedule:
    Type: AWS::Scheduler::Schedule
    Properties:
      ScheduleExpression: "cron(0 2 * * ? *)" # 2 AM daily
      FlexibleTimeWindow:
        Mode: "OFF"
      Target:
        Arn: !GetAtt WorkerFunction.Arn
        RoleArn: !GetAtt SchedulerRole.Arn
        Input: '{"jobName": "daily-cleanup", "payload": {}}'
```
