import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

interface IngestionStackProps extends cdk.StackProps {
  stage: string;
  projectName: string;
  rawBucket: s3.IBucket;
  lambdaTriggerRole: iam.IRole;
}

export class IngestionStack extends cdk.Stack {
  public readonly triggerFunction: lambda.Function;
  // Exposed for ProcessingStack (Glue reads lock) and GovernanceStack would cause circular dep —
  // glueRole DynamoDB permission uses deterministic ARN in GovernanceStack instead
  public readonly jobLocksTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: IngestionStackProps) {
    super(scope, id, props);

    const { stage, projectName, rawBucket, lambdaTriggerRole } = props;
    const isProd = stage === 'prod';

    // PAY_PER_REQUEST: lock ops are infrequent — provisioned capacity would waste money
    this.jobLocksTable = new dynamodb.Table(this, 'JobLocksTable', {
      tableName: `${projectName}-${stage}-dynamo-job-locks`,
      partitionKey: { name: 'module', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      // TTL auto-deletes stale locks if job crashes without releasing
      timeToLiveAttribute: 'ttl',
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // Lambda handler — bundles lambda/ directory at cdk deploy time
    this.triggerFunction = new lambda.Function(this, 'TriggerGlueFunction', {
      functionName: `${projectName}-${stage}-lambda-trigger-glue`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'trigger_glue.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda')),
      role: lambdaTriggerRole,
      timeout: cdk.Duration.seconds(30),
      environment: {
        PROJECT_NAME: projectName,
        STAGE: stage,
        LOCKS_TABLE: this.jobLocksTable.tableName,
      },
    });

    // EventBridge rule: fires on any object upload to the raw bucket
    // S3 bucket must have eventBridgeEnabled: true — set in StorageStack Phase 1
    new events.Rule(this, 'S3UploadRule', {
      ruleName: `${projectName}-${stage}-events-s3-upload`,
      eventPattern: {
        source: ['aws.s3'],
        detailType: ['Object Created'],
        detail: {
          bucket: { name: [rawBucket.bucketName] },
          // Filter to raw/ prefix only — ignore any other uploads to the bucket
          object: { key: [{ prefix: 'raw/' }] },
        },
      },
      targets: [new targets.LambdaFunction(this.triggerFunction)],
    });

    new cdk.CfnOutput(this, 'JobLocksTableName', {
      value: this.jobLocksTable.tableName,
      exportName: `${projectName}-${stage}-dynamo-job-locks-name`,
    });
  }
}
