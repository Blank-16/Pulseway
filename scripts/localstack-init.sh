#!/bin/bash
set -e
awslocal sqs create-queue --queue-name check-jobs.fifo --attributes FifoQueue=true,ContentBasedDeduplication=false
awslocal sqs create-queue --queue-name check-jobs-dlq.fifo --attributes FifoQueue=true,ContentBasedDeduplication=false
awslocal sqs create-queue --queue-name alert-jobs --attributes VisibilityTimeout=60
echo "SQS queues created"
