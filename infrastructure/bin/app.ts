#!/usr/bin/env node
import 'dotenv/config';
import * as cdk from 'aws-cdk-lib';
import { StorageStack } from '../lib/storage-stack';

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

new StorageStack(app, `${projectName}-${stage}-storage`, {
  env: defaultEnv,
  tags: defaultTags,
  stage,
  projectName,
});
