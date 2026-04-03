import * as cdk from 'aws-cdk-lib';
import * as athena from 'aws-cdk-lib/aws-athena';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

interface GovernanceStackProps extends cdk.StackProps {
  stage: string;
  projectName: string;
  rawBucket: s3.IBucket;
  processedBucket: s3.IBucket;
  artifactsBucket: s3.IBucket;
}

const SAP_MODULES = ['sd', 'mm', 'fi', 'co', 'pm'] as const;
type SapModule = (typeof SAP_MODULES)[number];

export class GovernanceStack extends cdk.Stack {
  // Exposed for ProcessingStack (Glue Jobs) and IngestionStack (Lambda)
  public readonly glueRole: iam.Role;
  public readonly lambdaTriggerRole: iam.Role;
  // Exposed for Lake Formation permissions (one role per SAP module)
  public readonly analystRoles: Record<SapModule, iam.Role>;

  constructor(scope: Construct, id: string, props: GovernanceStackProps) {
    super(scope, id, props);

    const { stage, projectName, rawBucket, processedBucket, artifactsBucket } = props;

    // --- Glue Job Role ---
    // AWSGlueServiceRole covers CloudWatch Logs + basic Glue service calls
    this.glueRole = new iam.Role(this, 'GlueRole', {
      roleName: `${projectName}-${stage}-glue-role`,
      assumedBy: new iam.ServicePrincipal('glue.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSGlueServiceRole'),
      ],
    });

    // Read raw CSVs — source data for ETL
    this.glueRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['s3:GetObject', 's3:ListBucket'],
      resources: [rawBucket.bucketArn, `${rawBucket.bucketArn}/*`],
    }));

    // Read+write processed — Delta Lake output
    this.glueRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject', 's3:ListBucket'],
      resources: [processedBucket.bucketArn, `${processedBucket.bucketArn}/*`],
    }));

    // Read artifacts — scripts and Python wheels
    this.glueRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['s3:GetObject', 's3:ListBucket'],
      resources: [artifactsBucket.bucketArn, `${artifactsBucket.bucketArn}/*`],
    }));

    // Glue Catalog: read databases and write tables in processed_* only
    this.glueRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['glue:GetDatabase', 'glue:GetDatabases'],
      resources: [
        `arn:aws:glue:${this.region}:${this.account}:catalog`,
        `arn:aws:glue:${this.region}:${this.account}:database/raw_*`,
        `arn:aws:glue:${this.region}:${this.account}:database/processed_*`,
      ],
    }));

    this.glueRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'glue:CreateTable', 'glue:UpdateTable', 'glue:GetTable', 'glue:GetTables',
        'glue:BatchCreatePartition', 'glue:CreatePartition',
        'glue:GetPartition', 'glue:GetPartitions', 'glue:BatchGetPartition',
      ],
      resources: [
        `arn:aws:glue:${this.region}:${this.account}:catalog`,
        `arn:aws:glue:${this.region}:${this.account}:database/processed_*`,
        `arn:aws:glue:${this.region}:${this.account}:table/processed_*/*`,
        // Read-only on raw tables (needed for schema validation)
        `arn:aws:glue:${this.region}:${this.account}:database/raw_*`,
        `arn:aws:glue:${this.region}:${this.account}:table/raw_*/*`,
      ],
    }));

    // DynamoDB lock table — Glue reads lock on start, releases on finish (safety net)
    // Uses deterministic ARN to avoid circular dependency with IngestionStack
    this.glueRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'dynamodb:GetItem', 'dynamodb:PutItem',
        'dynamodb:UpdateItem', 'dynamodb:DeleteItem',
      ],
      resources: [
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${projectName}-${stage}-dynamo-job-locks`,
      ],
    }));

    // --- Lambda Trigger Role ---
    // AWSLambdaBasicExecutionRole covers CloudWatch Logs only
    this.lambdaTriggerRole = new iam.Role(this, 'LambdaTriggerRole', {
      roleName: `${projectName}-${stage}-lambda-trigger-role`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Start and monitor Glue Jobs — scoped to this project's jobs only
    this.lambdaTriggerRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['glue:StartJobRun', 'glue:GetJobRun', 'glue:GetJob'],
      resources: [
        `arn:aws:glue:${this.region}:${this.account}:job/${projectName}-${stage}-*`,
      ],
    }));

    // DynamoDB optimistic locking — scoped to job-locks table only
    this.lambdaTriggerRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'dynamodb:PutItem', 'dynamodb:GetItem',
        'dynamodb:UpdateItem', 'dynamodb:DeleteItem',
      ],
      resources: [
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${projectName}-${stage}-dynamo-job-locks`,
      ],
    }));

    // --- Analyst Roles (one per SAP module) ---
    // IAM layer: Athena + Glue Catalog API access
    // Data layer: Lake Formation column-level security enforced at query time
    this.analystRoles = Object.fromEntries(
      SAP_MODULES.map(module => {
        const role = new iam.Role(this, `AnalystRole${module.toUpperCase()}`, {
          roleName: `${projectName}-${stage}-lakeformation-${module}-analyst-role`,
          // Any principal in this account can assume the role (demo: no specific user/group)
          assumedBy: new iam.AccountPrincipal(this.account),
        });

        // Athena: execute queries and read results
        role.addToPolicy(new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'athena:StartQueryExecution', 'athena:GetQueryExecution',
            'athena:GetQueryResults', 'athena:StopQueryExecution',
            'athena:GetWorkGroup',
          ],
          resources: [
            `arn:aws:athena:${this.region}:${this.account}:workgroup/${projectName}-${stage}-workgroup`,
          ],
        }));

        // Glue Catalog: read tables in their module only (Lake Formation further restricts columns)
        role.addToPolicy(new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['glue:GetDatabase', 'glue:GetTable', 'glue:GetTables', 'glue:GetPartitions'],
          resources: [
            `arn:aws:glue:${this.region}:${this.account}:catalog`,
            `arn:aws:glue:${this.region}:${this.account}:database/processed_${module}`,
            `arn:aws:glue:${this.region}:${this.account}:table/processed_${module}/*`,
          ],
        }));

        // S3: read processed data for their module + write Athena results
        role.addToPolicy(new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['s3:GetObject', 's3:ListBucket'],
          resources: [
            processedBucket.bucketArn,
            `${processedBucket.bucketArn}/processed/${module}/*`,
          ],
        }));

        role.addToPolicy(new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['s3:GetObject', 's3:PutObject', 's3:ListBucket'],
          resources: [
            artifactsBucket.bucketArn,
            `${artifactsBucket.bucketArn}/athena-results/*`,
          ],
        }));

        return [module, role];
      })
    ) as Record<SapModule, iam.Role>;

    // --- Athena Workgroup ---
    // Enforces query result location and byte scan limit — prevents costly runaway queries
    new athena.CfnWorkGroup(this, 'AthenaWorkgroup', {
      name: `${projectName}-${stage}-workgroup`,
      // enforceWorkGroupConfiguration: analysts cannot override byte limit or result location
      workGroupConfiguration: {
        enforceWorkGroupConfiguration: true,
        publishCloudWatchMetricsEnabled: true,
        resultConfiguration: {
          // Athena results in artifacts bucket — separate from data buckets
          outputLocation: `s3://${artifactsBucket.bucketName}/athena-results/`,
        },
        // 1 GB limit per query: $0.005 max per query at $5/TB
        bytesScannedCutoffPerQuery: 1_073_741_824,
      },
    });

    new cdk.CfnOutput(this, 'GlueRoleArn', {
      value: this.glueRole.roleArn,
      exportName: `${projectName}-${stage}-glue-role-arn`,
    });

    new cdk.CfnOutput(this, 'LambdaTriggerRoleArn', {
      value: this.lambdaTriggerRole.roleArn,
      exportName: `${projectName}-${stage}-lambda-trigger-role-arn`,
    });

    new cdk.CfnOutput(this, 'AthenaWorkgroupName', {
      value: `${projectName}-${stage}-workgroup`,
      exportName: `${projectName}-${stage}-athena-workgroup-name`,
    });
  }
}
