import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { StorageStack } from '../lib/stacks/storage-stack';

describe('StorageStack', () => {
  let app: cdk.App;
  let stack: StorageStack;
  let template: Template;

  beforeEach(() => {
    app = new cdk.App({
      context: {
        projectName: 'sap-demo',
        environment: 'dev',
      },
    });

    stack = new StorageStack(app, 'test-storage-stack', {
      environment: 'dev',
      projectName: 'sap-demo',
      env: { account: '123456789012', region: 'us-east-1' },
    });

    template = Template.fromStack(stack);
  });

  test('crea 3 buckets S3 con el naming correcto', () => {
    template.resourceCountIs('AWS::S3::Bucket', 3);

    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: 'sap-demo-dev-raw-sap',
      VersioningConfiguration: { Status: 'Enabled' },
    });

    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: 'sap-demo-dev-processed-sap',
      VersioningConfiguration: { Status: 'Enabled' },
    });

    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: 'sap-demo-dev-artifacts-sap',
      VersioningConfiguration: { Status: 'Enabled' },
    });
  });

  test('todos los buckets bloquean acceso público', () => {
    template.allResourcesProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  test('todos los buckets tienen SSL enforced', () => {
    // Cada bucket debe tener una BucketPolicy que deniegue HTTP
    template.resourceCountIs('AWS::S3::BucketPolicy', 3);
  });

  test('crea la Glue Database con el nombre correcto', () => {
    template.resourceCountIs('AWS::Glue::Database', 1);
    template.hasResourceProperties('AWS::Glue::Database', {
      DatabaseInput: {
        Name: 'sap-demo-dev-catalog',
      },
    });
  });

  test('exporta los Outputs de CloudFormation', () => {
    template.hasOutput('RawBucketArn', {});
    template.hasOutput('ProcessedBucketArn', {});
    template.hasOutput('ArtifactsBucketArn', {});
    template.hasOutput('GlueDatabaseName', {});
  });

  test('snapshot del template CloudFormation', () => {
    expect(template.toJSON()).toMatchSnapshot();
  });
});
