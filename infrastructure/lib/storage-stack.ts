import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as glue from 'aws-cdk-lib/aws-glue';
import { Construct } from 'constructs';

interface StorageStackProps extends cdk.StackProps {
  stage: string;
  projectName: string;
}

const SAP_MODULES = ['sd', 'mm', 'fi', 'co', 'pm'] as const;
type SapModule = (typeof SAP_MODULES)[number];

export class StorageStack extends cdk.Stack {
  // Exposed for other stacks (IngestionStack, ProcessingStack, GovernanceStack)
  public readonly rawBucket: s3.Bucket;
  public readonly processedBucket: s3.Bucket;
  public readonly artifactsBucket: s3.Bucket;
  // Glue Catalog databases — keyed by SAP module
  public readonly rawDatabases: Record<SapModule, glue.CfnDatabase>;
  public readonly processedDatabases: Record<SapModule, glue.CfnDatabase>;
  public readonly dictionaryDatabase: glue.CfnDatabase;

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

    // Delta Lake files: recent partitions read often, historical rarely
    // Intelligent-Tiering auto-moves objects between tiers based on access patterns
    this.processedBucket = new s3.Bucket(this, 'ProcessedBucket', {
      bucketName: `${projectName}-${stage}-s3-processed-sap`,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      // FinOps: Intelligent-Tiering after 90d — access pattern becomes unpredictable
      lifecycleRules: [
        {
          id: 'processed-to-intelligent-tiering',
          transitions: [
            {
              storageClass: s3.StorageClass.INTELLIGENT_TIERING,
              transitionAfter: cdk.Duration.days(90),
            },
          ],
        },
      ],
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: !isProd,
    });

    // Glue Job scripts and Python wheel dependencies
    this.artifactsBucket = new s3.Bucket(this, 'ArtifactsBucket', {
      bucketName: `${projectName}-${stage}-s3-artifacts-sap`,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: !isProd,
    });

    // One database per SAP module per layer — GovernanceStack uses these for Lake Formation permissions
    this.rawDatabases = Object.fromEntries(
      SAP_MODULES.map(module => [
        module,
        new glue.CfnDatabase(this, `RawDb${module.toUpperCase()}`, {
          catalogId: this.account,
          databaseInput: { name: `raw_${module}` },
        }),
      ])
    ) as Record<SapModule, glue.CfnDatabase>;

    this.processedDatabases = Object.fromEntries(
      SAP_MODULES.map(module => [
        module,
        new glue.CfnDatabase(this, `ProcessedDb${module.toUpperCase()}`, {
          catalogId: this.account,
          databaseInput: { name: `processed_${module}` },
        }),
      ])
    ) as Record<SapModule, glue.CfnDatabase>;

    // SAP data dictionary — column metadata used for Athena Curated views
    this.dictionaryDatabase = new glue.CfnDatabase(this, 'DictionaryDb', {
      catalogId: this.account,
      databaseInput: { name: 'sap_dictionary' },
    });

    new cdk.CfnOutput(this, 'RawBucketName', {
      value: this.rawBucket.bucketName,
      exportName: `${projectName}-${stage}-raw-bucket-name`,
    });

    new cdk.CfnOutput(this, 'RawBucketArn', {
      value: this.rawBucket.bucketArn,
      exportName: `${projectName}-${stage}-raw-bucket-arn`,
    });

    new cdk.CfnOutput(this, 'ProcessedBucketName', {
      value: this.processedBucket.bucketName,
      exportName: `${projectName}-${stage}-processed-bucket-name`,
    });

    new cdk.CfnOutput(this, 'ProcessedBucketArn', {
      value: this.processedBucket.bucketArn,
      exportName: `${projectName}-${stage}-processed-bucket-arn`,
    });

    new cdk.CfnOutput(this, 'ArtifactsBucketName', {
      value: this.artifactsBucket.bucketName,
      exportName: `${projectName}-${stage}-artifacts-bucket-name`,
    });

    new cdk.CfnOutput(this, 'ArtifactsBucketArn', {
      value: this.artifactsBucket.bucketArn,
      exportName: `${projectName}-${stage}-artifacts-bucket-arn`,
    });
  }
}
