#!/bin/bash
set -euo pipefail

echo "Waiting for LocalStack to be ready..."
until awslocal sqs list-queues &>/dev/null 2>&1; do
  sleep 1
done

echo "Creating SQS queues..."
awslocal sqs create-queue --queue-name check-jobs-dlq
awslocal sqs create-queue --queue-name alert-jobs-dlq

DLQ_CHECK_ARN=$(awslocal sqs get-queue-attributes \
  --queue-url http://localhost:4566/000000000000/check-jobs-dlq \
  --attribute-names QueueArn \
  --query Attributes.QueueArn --output text)

DLQ_ALERT_ARN=$(awslocal sqs get-queue-attributes \
  --queue-url http://localhost:4566/000000000000/alert-jobs-dlq \
  --attribute-names QueueArn \
  --query Attributes.QueueArn --output text)

awslocal sqs create-queue \
  --queue-name check-jobs \
  --attributes "VisibilityTimeout=30,RedrivePolicy={\"deadLetterTargetArn\":\"${DLQ_CHECK_ARN}\",\"maxReceiveCount\":3}"

awslocal sqs create-queue \
  --queue-name alert-jobs \
  --attributes "VisibilityTimeout=60,RedrivePolicy={\"deadLetterTargetArn\":\"${DLQ_ALERT_ARN}\",\"maxReceiveCount\":3}"

echo "Creating S3 bucket..."
awslocal s3 mb s3://pulseway-assets

echo "Creating Secrets Manager secrets..."
awslocal secretsmanager create-secret \
  --name pulseway/local/jwt-secret \
  --secret-string "local-dev-jwt-secret-not-for-production-min-32"

awslocal secretsmanager create-secret \
  --name pulseway/local/stripe-secret-key \
  --secret-string "sk_test_local"

echo "LocalStack setup complete."
