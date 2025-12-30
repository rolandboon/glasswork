# AWS Setup Guide

This guide covers AWS infrastructure for background jobs using AWS SAM.

## Prerequisites

- AWS Account with appropriate IAM permissions
- AWS SAM CLI installed

## Standard Setup

A basic setup includes an SQS queue, Dead Letter Queue, and Worker Lambda:

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

  JobQueueDLQ:
    Type: AWS::SQS::Queue
    Properties:
      QueueName: !Sub ${AWS::StackName}-jobs-dlq

  JobQueue:
    Type: AWS::SQS::Queue
    Properties:
      QueueName: !Sub ${AWS::StackName}-jobs
      VisibilityTimeout: 180  # Must be >= Lambda timeout * 6
      RedrivePolicy:
        deadLetterTargetArn: !GetAtt JobQueueDLQ.Arn
        maxReceiveCount: 3

  # ===================
  # Worker Lambda
  # ===================

  WorkerFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: !Sub ${AWS::StackName}-worker
      Handler: dist/worker.handler
      Runtime: nodejs22.x
      Timeout: 30
      MemorySize: 512
      Environment:
        Variables:
          NODE_ENV: !Ref Environment
          JOB_QUEUE_URL: !Ref JobQueue
      Policies:
        - SQSPollerPolicy:
            QueueName: !GetAtt JobQueue.QueueName
      Events:
        SQSEvent:
          Type: SQS
          Properties:
            Queue: !GetAtt JobQueue.Arn
            BatchSize: 10

Outputs:
  JobQueueUrl:
    Description: URL of the job queue
    Value: !Ref JobQueue
```

## EventBridge Scheduler for Long Delays

For jobs with delays longer than 15 minutes, Glasswork uses AWS EventBridge Scheduler. Add the following resources:

```yaml
  # ===================
  # EventBridge Scheduler
  # ===================

  SchedulerRole:
    Type: AWS::IAM::Role
    Properties:
      AssumeRolePolicyDocument:
        Version: '2012-10-17'
        Statement:
          - Effect: Allow
            Principal:
              Service: scheduler.amazonaws.com
            Action: sts:AssumeRole
      Policies:
        - PolicyName: SendToJobQueue
          PolicyDocument:
            Version: '2012-10-17'
            Statement:
              - Effect: Allow
                Action: sqs:SendMessage
                Resource: !GetAtt JobQueue.Arn
```

Then add the scheduler permissions to your API Lambda (or wherever jobs are enqueued):

```yaml
  ApiFunction:
    Type: AWS::Serverless::Function
    Properties:
      # ... other properties ...
      Environment:
        Variables:
          SCHEDULER_ROLE_ARN: !GetAtt SchedulerRole.Arn
      Policies:
        - Statement:
            - Effect: Allow
              Action:
                - scheduler:CreateSchedule
                - scheduler:DeleteSchedule
              Resource: !Sub arn:aws:scheduler:${AWS::Region}:${AWS::AccountId}:schedule/default/*
        - Statement:
            - Effect: Allow
              Action: iam:PassRole
              Resource: !GetAtt SchedulerRole.Arn
```

Configure the driver with the scheduler role:

```typescript
new SQSQueueDriver({
  region: config.get('awsRegion'),
  queues: { default: config.get('jobQueueUrl') },
  scheduler: {
    region: config.get('awsRegion'),
    roleArn: config.get('schedulerRoleArn'),  // From env var
  },
});
```

## FIFO Queues

For strict ordering or exactly-once processing:

```yaml
  JobQueueFIFO:
    Type: AWS::SQS::Queue
    Properties:
      QueueName: !Sub ${AWS::StackName}-jobs.fifo
      FifoQueue: true
      ContentBasedDeduplication: false
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

## Periodic Jobs (Cron)

Trigger periodic jobs using EventBridge Schedules:

```yaml
  DailyCleanupSchedule:
    Type: AWS::Scheduler::Schedule
    Properties:
      Name: daily-cleanup
      ScheduleExpression: "cron(0 2 * * ? *)"  # 2 AM daily
      FlexibleTimeWindow:
        Mode: "OFF"
      Target:
        Arn: !GetAtt WorkerFunction.Arn
        RoleArn: !GetAtt SchedulerRole.Arn
        Input: '{"jobName": "daily-cleanup", "payload": {}}'

  SchedulerInvokePermission:
    Type: AWS::Lambda::Permission
    Properties:
      FunctionName: !Ref WorkerFunction
      Action: lambda:InvokeFunction
      Principal: scheduler.amazonaws.com
      SourceArn: !GetAtt DailyCleanupSchedule.Arn
```

## Environment Variables Summary

| Variable | Description | Example |
|----------|-------------|---------|
| `JOB_QUEUE_URL` | SQS queue URL | `https://sqs.eu-west-1.amazonaws.com/...` |
| `SCHEDULER_ROLE_ARN` | IAM role for EventBridge Scheduler | `arn:aws:iam::123:role/...` |
| `AWS_REGION` | AWS region | `eu-west-1` |
