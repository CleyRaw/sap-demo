import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as glue from 'aws-cdk-lib/aws-glue';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { Construct } from 'constructs';

interface ProcessingStackProps extends cdk.StackProps {
  stage: string;
  projectName: string;
  rawBucket: s3.IBucket;
  processedBucket: s3.IBucket;
  artifactsBucket: s3.IBucket;
  glueRole: iam.IRole;
  jobLocksTableName: string;
}

const SAP_MODULES = ['sd', 'mm', 'fi', 'co', 'pm'] as const;
type SapModule = (typeof SAP_MODULES)[number];

// polars + deltalake + structlog — pinned for reproducibility
const PYTHON_MODULES = 'polars==1.12.0,deltalake==0.22.3,structlog==24.4.0';

export class ProcessingStack extends cdk.Stack {
  public readonly glueJobs: Record<SapModule, glue.CfnJob>;

  constructor(scope: Construct, id: string, props: ProcessingStackProps) {
    super(scope, id, props);

    const { stage, projectName, rawBucket, processedBucket, artifactsBucket, glueRole, jobLocksTableName } = props;

    // Upload shared ETL script to artifacts bucket during cdk deploy
    // BucketDeployment uses a Lambda custom resource to sync local files to S3
    new s3deploy.BucketDeployment(this, 'GlueScripts', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '../../glue/scripts'))],
      destinationBucket: artifactsBucket,
      destinationKeyPrefix: 'glue/scripts/',
    });

    const scriptLocation = `s3://${artifactsBucket.bucketName}/glue/scripts/sap_raw_to_processed.py`;

    // One job per SAP module — same script, different --SAP_MODULE argument
    this.glueJobs = Object.fromEntries(
      SAP_MODULES.map(module => [
        module,
        new glue.CfnJob(this, `GlueJob${module.toUpperCase()}`, {
          name: `${projectName}-${stage}-glue-${module}-raw-to-processed`,
          role: glueRole.roleArn,
          glueVersion: '3.0',
          command: {
            name: 'pythonshell',
            pythonVersion: '3.9',
            scriptLocation,
          },
          // 0.0625 DPU = minimum for Python Shell = ~$0.028/hr ($0.44 * 0.0625)
          maxCapacity: 0.0625,
          defaultArguments: {
            '--job-language': 'python',
            '--additional-python-modules': PYTHON_MODULES,
            '--RAW_BUCKET': rawBucket.bucketName,
            '--PROCESSED_BUCKET': processedBucket.bucketName,
            '--SAP_MODULE': module,
            '--STAGE': stage,
            '--LOCKS_TABLE': jobLocksTableName,
          },
          executionProperty: {
            // Prevent concurrent runs on the same module — DynamoDB lock (Phase 8) enforces this at app level
            maxConcurrentRuns: 1,
          },
        }),
      ])
    ) as Record<SapModule, glue.CfnJob>;
  }
}
