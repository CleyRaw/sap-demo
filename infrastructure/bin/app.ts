#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { StorageStack } from '../lib/stacks/storage-stack';

const app = new cdk.App();

// Lee el ambiente y el nombre del proyecto desde cdk.json context.
// Se puede sobreescribir en CLI: cdk deploy -c environment=prod
const environment = app.node.tryGetContext('environment') as
  | 'dev'
  | 'staging'
  | 'prod';
const projectName = app.node.tryGetContext('projectName') as string;

if (!environment || !['dev', 'staging', 'prod'].includes(environment)) {
  throw new Error(
    `Context 'environment' debe ser 'dev', 'staging' o 'prod'. Recibido: ${environment}`,
  );
}

if (!projectName) {
  throw new Error(`Context 'projectName' es requerido en cdk.json`);
}

// CDK_DEFAULT_ACCOUNT y CDK_DEFAULT_REGION son seteadas automáticamente
// por el CDK CLI usando las credenciales AWS activas (AWS_PROFILE o env vars).
const env: cdk.Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
};

new StorageStack(app, 'storage-stack', {
  environment,
  projectName,
  env,
  // Stack description visible en la consola de CloudFormation
  description: `SAP Demo — StorageStack [${environment}]: S3 buckets (raw, processed, artifacts) + Glue Catalog database`,
  // Tags heredados por todos los recursos del stack
  tags: {
    Project: projectName,
    Environment: environment,
  },
});
