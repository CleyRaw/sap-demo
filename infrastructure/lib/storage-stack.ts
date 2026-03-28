import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

interface StorageStackProps extends cdk.StackProps {
  stage: string;
  projectName: string;
}

export class StorageStack extends cdk.Stack {
  // Exposed for other stacks (IngestionStack, ProcessingStack)
  public readonly rawBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);

    const { stage, projectName } = props;
    const isProd = stage === 'prod';

    this.rawBucket = new s3.Bucket(this, 'RawBucket', {
      bucketName: `${projectName}-${stage}-s3-raw-sap`,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      // EventBridge: required for IngestionStack (Phase 6)
      eventBridgeEnabled: true,
      // FinOps: IA after 30d — RAW data is rarely read after processing
      lifecycleRules: [
        {
          id: 'raw-to-infrequent-access',
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(30),
            },
          ],
        },
      ],
      // dev: allow cleanup — prod: never delete data
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: !isProd,
    });

    new cdk.CfnOutput(this, 'RawBucketName', {
      value: this.rawBucket.bucketName,
      exportName: `${projectName}-${stage}-raw-bucket-name`,
    });

    new cdk.CfnOutput(this, 'RawBucketArn', {
      value: this.rawBucket.bucketArn,
      exportName: `${projectName}-${stage}-raw-bucket-arn`,
    });
  }
}
