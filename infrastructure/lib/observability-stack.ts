import * as cdk from 'aws-cdk-lib';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cw_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sns_subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import { Construct } from 'constructs';

interface ObservabilityStackProps extends cdk.StackProps {
  stage: string;
  projectName: string;
  monthlyBudgetUsd: number;
  alertEmail?: string; // Optional — creates SNS subscription if provided
}

const SAP_MODULES = ['sd', 'mm', 'fi', 'co', 'pm'] as const;

export class ObservabilityStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, props);

    const { stage, projectName, monthlyBudgetUsd, alertEmail } = props;
    const isProd = stage === 'prod';

    // --- SNS Topic ---
    // Single topic for all alerts: Glue failures, Lambda errors, budget notifications
    const alertTopic = new sns.Topic(this, 'AlertTopic', {
      topicName: `${projectName}-${stage}-sns-alerts`,
    });

    if (alertEmail) {
      alertTopic.addSubscription(new sns_subscriptions.EmailSubscription(alertEmail));
    }

    // --- CloudWatch Alarms: Glue Job Failures ---
    // One alarm per module — detects any failed task in a 5-minute window
    const glueAlarms = SAP_MODULES.map(module => {
      const jobName = `${projectName}-${stage}-glue-${module}-raw-to-processed`;

      const alarm = new cloudwatch.Alarm(this, `GlueAlarm${module.toUpperCase()}`, {
        alarmName: `${projectName}-${stage}-alarm-glue-${module}-failures`,
        metric: new cloudwatch.Metric({
          namespace: 'Glue',
          metricName: 'glue.driver.aggregate.numFailedTask',
          dimensionsMap: { JobName: jobName },
          statistic: 'Sum',
          period: cdk.Duration.minutes(5),
        }),
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        // No data = job hasn't run = not a problem
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });

      alarm.addAlarmAction(new cw_actions.SnsAction(alertTopic));
      return alarm;
    });

    // --- CloudWatch Alarm: Lambda Trigger Errors ---
    const lambdaFunctionName = `${projectName}-${stage}-lambda-trigger-glue`;

    const lambdaAlarm = new cloudwatch.Alarm(this, 'LambdaErrorsAlarm', {
      alarmName: `${projectName}-${stage}-alarm-lambda-trigger-errors`,
      metric: new cloudwatch.Metric({
        namespace: 'AWS/Lambda',
        metricName: 'Errors',
        dimensionsMap: { FunctionName: lambdaFunctionName },
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    lambdaAlarm.addAlarmAction(new cw_actions.SnsAction(alertTopic));

    // --- CloudWatch Dashboard ---
    new cloudwatch.Dashboard(this, 'Dashboard', {
      dashboardName: `${projectName}-${stage}-dashboard`,
      widgets: [
        // Row 1: Glue failures per module
        [
          new cloudwatch.AlarmStatusWidget({
            title: 'Glue Jobs — Estado',
            alarms: glueAlarms,
            width: 12,
          }),
          new cloudwatch.AlarmStatusWidget({
            title: 'Lambda Trigger — Estado',
            alarms: [lambdaAlarm],
            width: 12,
          }),
        ],
        // Row 2: Glue failure counts over time
        [
          new cloudwatch.GraphWidget({
            title: 'Glue Job Failures (5m)',
            width: 24,
            left: SAP_MODULES.map(module =>
              new cloudwatch.Metric({
                namespace: 'Glue',
                metricName: 'glue.driver.aggregate.numFailedTask',
                dimensionsMap: {
                  JobName: `${projectName}-${stage}-glue-${module}-raw-to-processed`,
                },
                statistic: 'Sum',
                period: cdk.Duration.minutes(5),
                label: `${module.toUpperCase()} failures`,
              })
            ),
          }),
        ],
      ],
    });

    // --- Log Retention ---
    // Lambda log group — CDK creates it explicitly to set retention before Lambda runs
    new logs.LogGroup(this, 'LambdaTriggerLogGroup', {
      logGroupName: `/aws/lambda/${lambdaFunctionName}`,
      retention: isProd ? logs.RetentionDays.ONE_MONTH : logs.RetentionDays.ONE_WEEK,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // Glue log groups are account-wide (shared across all jobs)
    // Setting retention here affects all Glue jobs in this account
    for (const logGroupName of ['/aws-glue/jobs/output', '/aws-glue/jobs/error']) {
      new logs.LogGroup(this, `GlueLogGroup${logGroupName.split('/').pop()}`, {
        logGroupName,
        retention: isProd ? logs.RetentionDays.ONE_MONTH : logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.RETAIN, // Never delete Glue logs on destroy
      });
    }

    // --- AWS Budget ---
    // Notifications at 80% (warning) and 100% (critical) via SNS
    new budgets.CfnBudget(this, 'MonthlyCostBudget', {
      budget: {
        budgetName: `${projectName}-${stage}-budget`,
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: { amount: monthlyBudgetUsd, unit: 'USD' },
      },
      notificationsWithSubscribers: [
        {
          notification: {
            notificationType: 'ACTUAL',
            comparisonOperator: 'GREATER_THAN',
            threshold: 80,
            thresholdType: 'PERCENTAGE',
          },
          subscribers: [{ subscriptionType: 'SNS', address: alertTopic.topicArn }],
        },
        {
          notification: {
            notificationType: 'ACTUAL',
            comparisonOperator: 'GREATER_THAN',
            threshold: 100,
            thresholdType: 'PERCENTAGE',
          },
          subscribers: [{ subscriptionType: 'SNS', address: alertTopic.topicArn }],
        },
      ],
    });

    new cdk.CfnOutput(this, 'AlertTopicArn', {
      value: alertTopic.topicArn,
      exportName: `${projectName}-${stage}-alert-topic-arn`,
    });
  }
}
