#!/usr/bin/env node
import * as path from 'path';
import { config } from 'dotenv';

// Load .env.{ENV_FILE} or .env by default — e.g. ENV_FILE=prod loads .env.prod
const envFile = process.env.ENV_FILE ?? '';
config({ path: path.resolve(__dirname, '..', envFile ? `.env.${envFile}` : '.env') });

import * as cdk from 'aws-cdk-lib';
import { StorageStack } from '../lib/storage-stack';
import { GovernanceStack } from '../lib/governance-stack';
import { IngestionStack } from '../lib/ingestion-stack';
import { ProcessingStack } from '../lib/processing-stack';
import { ObservabilityStack } from '../lib/observability-stack';

const app = new cdk.App();

const projectName = app.node.tryGetContext('projectName') ?? 'sap-demo';
const stage = process.env.STAGE;
if (!stage) {
  throw new Error('STAGE is required. Set it in .env or export it: dev | staging | prod');
}

const defaultEnv: cdk.Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
};

const defaultTags: Record<string, string> = {
  Project: projectName,
  Stage: stage,
  ManagedBy: 'cdk',
};

const storageStack = new StorageStack(app, `${projectName}-${stage}-storage`, {
  env: defaultEnv,
  tags: defaultTags,
  stage,
  projectName,
});

const governanceStack = new GovernanceStack(app, `${projectName}-${stage}-governance`, {
  env: defaultEnv,
  tags: defaultTags,
  stage,
  projectName,
  rawBucket: storageStack.rawBucket,
  processedBucket: storageStack.processedBucket,
  artifactsBucket: storageStack.artifactsBucket,
});

const ingestionStack = new IngestionStack(app, `${projectName}-${stage}-ingestion`, {
  env: defaultEnv,
  tags: defaultTags,
  stage,
  projectName,
  rawBucket: storageStack.rawBucket,
  lambdaTriggerRole: governanceStack.lambdaTriggerRole,
});

new ProcessingStack(app, `${projectName}-${stage}-processing`, {
  env: defaultEnv,
  tags: defaultTags,
  stage,
  projectName,
  rawBucket: storageStack.rawBucket,
  processedBucket: storageStack.processedBucket,
  artifactsBucket: storageStack.artifactsBucket,
  glueRole: governanceStack.glueRole,
  jobLocksTableName: ingestionStack.jobLocksTable.tableName,
});

new ObservabilityStack(app, `${projectName}-${stage}-observability`, {
  env: defaultEnv,
  tags: defaultTags,
  stage,
  projectName,
  monthlyBudgetUsd: 15,
  alertEmail: process.env.ALERT_EMAIL,
});
