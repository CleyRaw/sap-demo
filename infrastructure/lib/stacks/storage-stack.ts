import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as glue from 'aws-cdk-lib/aws-glue';
import { Construct } from 'constructs';

export interface StorageStackProps extends cdk.StackProps {
  environment: 'dev' | 'staging' | 'prod';
  projectName: string;
}

export class StorageStack extends cdk.Stack {
  // Exports para que otros stacks (GovernanceStack, ProcessingStack) importen sin hardcodear ARNs
  public readonly rawBucket: s3.Bucket;
  public readonly processedBucket: s3.Bucket;
  public readonly artifactsBucket: s3.Bucket;
  public readonly glueDatabaseName: string;

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);

    const { environment, projectName } = props;
    const prefix = `${projectName}-${environment}`;

    // ─── S3: Raw bucket ──────────────────────────────────────────────────────
    // Recibe CSVs originales de SAP, particionados por módulo y fecha.
    // COST: S3 Standard ~$0.023/GB/mes. Para datos demo (<1GB) = ~$0.01/mes.
    this.rawBucket = new s3.Bucket(this, 'RawBucket', {
      bucketName: `${prefix}-raw-sap`,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      // RETAIN: nunca borrar datos por accidente al hacer cdk destroy
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          // Expirar versiones antiguas después de 30 días (FinOps)
          noncurrentVersionExpiration: cdk.Duration.days(30),
        },
      ],
    });

    // ─── S3: Processed bucket ─────────────────────────────────────────────────
    // Tablas Delta Lake con schema enforced y nombres técnicos SAP.
    // COST: S3 Intelligent-Tiering — sin costo adicional si los objetos superan 128KB.
    //       Para archivos Delta (Parquet) esto siempre aplica. Ahorro automático en accesos infrecuentes.
    this.processedBucket = new s3.Bucket(this, 'ProcessedBucket', {
      bucketName: `${prefix}-processed-sap`,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      intelligentTieringConfigurations: [
        {
          name: 'default-tiering',
          // Mover a Infrequent Access después de 90 días sin acceso
          archiveAccessTierTime: cdk.Duration.days(90),
          // Mover a Archive Access después de 180 días sin acceso
          deepArchiveAccessTierTime: cdk.Duration.days(180),
        },
      ],
      lifecycleRules: [
        {
          noncurrentVersionExpiration: cdk.Duration.days(30),
        },
      ],
    });

    // ─── S3: Artifacts bucket ────────────────────────────────────────────────
    // Scripts de Glue Jobs, diccionario SAP, configs, outputs de jobs.
    // COST: S3 Standard ~$0.023/GB/mes. Para scripts (<10MB) = $0.00/mes.
    this.artifactsBucket = new s3.Bucket(this, 'ArtifactsBucket', {
      bucketName: `${prefix}-artifacts-sap`,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ─── Glue Data Catalog: Database base ────────────────────────────────────
    // El Glue Catalog es el metastore central: guarda schemas, particiones y locations
    // de todas las tablas Delta. Athena y Lake Formation lo consultan para resolver queries.
    // COST: Primer millón de objetos = $0/mes. Para este demo = $0.
    const glueDatabase = new glue.CfnDatabase(this, 'GlueDatabase', {
      catalogId: this.account,
      databaseInput: {
        name: `${prefix}-catalog`,
        description: `SAP Demo Data Lakehouse — ${environment} environment. Contiene tablas Delta procesadas por módulo SAP (SD, MM, FI, CO, PM).`,
        locationUri: `s3://${this.processedBucket.bucketName}/`,
      },
    });

    this.glueDatabaseName = `${prefix}-catalog`;

    // ─── CloudFormation Outputs ───────────────────────────────────────────────
    // Los Outputs permiten que otros stacks importen estos valores sin hardcodear.
    // Patrón: cdk.Fn.importValue('ExportName') en el stack consumidor.
    new cdk.CfnOutput(this, 'RawBucketArn', {
      value: this.rawBucket.bucketArn,
      exportName: `${prefix}-raw-bucket-arn`,
      description: 'ARN del bucket S3 RAW para ingesta de CSVs SAP',
    });

    new cdk.CfnOutput(this, 'RawBucketName', {
      value: this.rawBucket.bucketName,
      exportName: `${prefix}-raw-bucket-name`,
      description: 'Nombre del bucket S3 RAW',
    });

    new cdk.CfnOutput(this, 'ProcessedBucketArn', {
      value: this.processedBucket.bucketArn,
      exportName: `${prefix}-processed-bucket-arn`,
      description: 'ARN del bucket S3 Processed (Delta Lake)',
    });

    new cdk.CfnOutput(this, 'ProcessedBucketName', {
      value: this.processedBucket.bucketName,
      exportName: `${prefix}-processed-bucket-name`,
      description: 'Nombre del bucket S3 Processed',
    });

    new cdk.CfnOutput(this, 'ArtifactsBucketArn', {
      value: this.artifactsBucket.bucketArn,
      exportName: `${prefix}-artifacts-bucket-arn`,
      description: 'ARN del bucket S3 de Artifacts (scripts, configs)',
    });

    new cdk.CfnOutput(this, 'ArtifactsBucketName', {
      value: this.artifactsBucket.bucketName,
      exportName: `${prefix}-artifacts-bucket-name`,
      description: 'Nombre del bucket S3 de Artifacts',
    });

    new cdk.CfnOutput(this, 'GlueDatabaseName', {
      value: this.glueDatabaseName,
      exportName: `${prefix}-glue-database-name`,
      description: 'Nombre de la Glue Catalog Database base',
    });

    // Tags globales del stack — aparecen en todos los recursos, útil para cost allocation
    cdk.Tags.of(this).add('Project', projectName);
    cdk.Tags.of(this).add('Environment', environment);
    cdk.Tags.of(this).add('ManagedBy', 'CDK');
    cdk.Tags.of(this).add('Stack', 'StorageStack');
  }
}
