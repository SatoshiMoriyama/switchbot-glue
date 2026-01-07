#!/usr/bin/env node
import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import * as dotenv from 'dotenv';
import { SwitchBotDataPipelineStack } from '../lib/cdk-stack';

// Load environment variables from .env file
dotenv.config({ path: path.join(__dirname, '../../../.env') });

const app = new cdk.App();

// Get region from environment variable or use default
const region = process.env.AWS_REGION || 'ap-northeast-1';

new SwitchBotDataPipelineStack(app, 'SwitchBotDataPipelineStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: region,
  },
  description:
    'SwitchBot Data Pipeline - Lambda functions and S3 buckets for data collection',
  tags: {
    Project: 'SwitchBotDataPipeline',
    Environment: 'Development',
    ManagedBy: 'CDK',
  },
});
