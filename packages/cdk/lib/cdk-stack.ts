import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import * as glue from 'aws-cdk-lib/aws-glue';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as schedulerTargets from 'aws-cdk-lib/aws-scheduler-targets';
import type { Construct } from 'constructs';
import * as dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config({ path: path.join(__dirname, '../../../.env') });

export class SwitchBotDataPipelineStack extends cdk.Stack {
  public readonly rawDataBucket: s3.Bucket;
  public readonly curatedDataBucket: s3.Bucket;
  public readonly scriptsBucket: s3.Bucket;
  public readonly lambdaExecutionRole: iam.Role;
  public readonly dataCollectionLambda: lambda.Function;
  public readonly glueDatabase: glue.CfnDatabase;
  public readonly glueCrawlerRole: iam.Role;
  public readonly rawDataCrawler: glue.CfnCrawler;
  public readonly glueJobRole: iam.Role;
  public readonly etlJob: glue.CfnJob;
  public readonly curatedDataCrawler: glue.CfnCrawler;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // S3 Buckets for data pipeline
    this.rawDataBucket = new s3.Bucket(this, 'SwitchBotRawDataBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For development
    });

    this.curatedDataBucket = new s3.Bucket(this, 'SwitchBotCuratedDataBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For development
    });

    this.scriptsBucket = new s3.Bucket(this, 'SwitchBotScriptsBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For development
    });

    // IAM Role for Lambda function execution
    this.lambdaExecutionRole = new iam.Role(
      this,
      'SwitchBotLambdaExecutionRole',
      {
        assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName(
            'service-role/AWSLambdaBasicExecutionRole',
          ),
        ],
      },
    );

    // Grant S3 permissions using CDK's high-level methods
    this.rawDataBucket.grantReadWrite(this.lambdaExecutionRole);
    this.curatedDataBucket.grantReadWrite(this.lambdaExecutionRole);

    // Validate required environment variables
    const switchbotToken = process.env.SWITCHBOT_TOKEN;
    const switchbotSecret = process.env.SWITCHBOT_SECRET;

    if (!switchbotToken || !switchbotSecret) {
      throw new Error(
        'SWITCHBOT_TOKEN and SWITCHBOT_SECRET must be set in .env file',
      );
    }

    // CloudWatch Log Group for Lambda function
    const lambdaLogGroup = new logs.LogGroup(this, 'SwitchBotLambdaLogGroup', {
      logGroupName: `/aws/lambda/SwitchBotDataCollectionFunction`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Lambda function for SwitchBot data collection
    this.dataCollectionLambda = new lambda.Function(
      this,
      'SwitchBotDataCollectionFunction',
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        handler: 'index.handler',
        code: lambda.Code.fromAsset(path.join(__dirname, '../../api/dist')),
        role: this.lambdaExecutionRole,
        timeout: cdk.Duration.minutes(5),
        memorySize: 256,
        environment: {
          SWITCHBOT_TOKEN: switchbotToken,
          SWITCHBOT_SECRET: switchbotSecret,
          S3_RAW_BUCKET: this.rawDataBucket.bucketName,
        },
        description: 'Collects data from SwitchBot API and stores in S3',
        logGroup: lambdaLogGroup,
      },
    );

    // EventBridge Scheduler for Lambda execution (every 15 minutes)
    const schedule = new scheduler.Schedule(
      this,
      'SwitchBotDataCollectionScheduler',
      {
        schedule: scheduler.ScheduleExpression.rate(cdk.Duration.minutes(15)),
        target: new schedulerTargets.LambdaInvoke(
          this.dataCollectionLambda,
          {},
        ),
        description: 'Triggers SwitchBot data collection every 15 minutes',
      },
    );

    // Glue Database for data catalog
    this.glueDatabase = new glue.CfnDatabase(this, 'SwitchBotGlueDatabase', {
      catalogId: this.account,
      databaseInput: {
        name: 'switchbot_data_catalog',
        description:
          'Database for SwitchBot temperature and humidity data catalog',
      },
    });

    // Manual Table Creation with Fixed Name
    const rawDataTable = new glue.CfnTable(this, 'SwitchBotRawDataTable', {
      catalogId: this.account,
      databaseName: 'switchbot_data_catalog',
      tableInput: {
        name: 'switchbot_raw_data', // Fixed table name!
        description: 'SwitchBot raw JSON data table',
        tableType: 'EXTERNAL_TABLE',
        parameters: {
          classification: 'json', // Add classification parameter
          compressionType: 'none', // Add compressionType parameter
        },
        storageDescriptor: {
          location: `s3://${this.rawDataBucket.bucketName}/`,
          inputFormat: 'org.apache.hadoop.mapred.TextInputFormat',
          outputFormat:
            'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat',
          serdeInfo: {
            serializationLibrary: 'org.openx.data.jsonserde.JsonSerDe',
          },
          columns: [], // Empty - Crawler will populate
        },
        partitionKeys: [
          { name: 'year', type: 'string' },
          { name: 'month', type: 'string' },
          { name: 'day', type: 'string' },
          { name: 'hour', type: 'string' },
        ],
      },
    });

    // Ensure table depends on database
    rawDataTable.addDependency(this.glueDatabase);

    // IAM Role for Glue Crawler
    this.glueCrawlerRole = new iam.Role(this, 'SwitchBotGlueCrawlerRole', {
      assumedBy: new iam.ServicePrincipal('glue.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AWSGlueServiceRole',
        ),
      ],
    });

    // Grant S3 permissions to Glue Crawler
    this.rawDataBucket.grantRead(this.glueCrawlerRole);
    this.curatedDataBucket.grantRead(this.glueCrawlerRole);

    // Raw Data Crawler - Update existing table schema
    this.rawDataCrawler = new glue.CfnCrawler(this, 'SwitchBotRawDataCrawler', {
      role: this.glueCrawlerRole.roleArn,
      databaseName: 'switchbot_data_catalog',
      targets: {
        catalogTargets: [
          {
            databaseName: 'switchbot_data_catalog',
            tables: ['switchbot_raw_data'],
          },
        ],
      },
      name: 'switchbot-raw-data-crawler',
      description: 'Crawler to update existing switchbot_raw_data table schema',
      tablePrefix: '',
      schedule: {
        scheduleExpression: 'cron(0 2 * * ? *)', // Daily at 2 AM UTC
      },
      schemaChangePolicy: {
        updateBehavior: 'UPDATE_IN_DATABASE',
        deleteBehavior: 'LOG',
      },
      configuration: JSON.stringify({
        Version: 1.0,
        CrawlerOutput: {
          Partitions: { AddOrUpdateBehavior: 'InheritFromTable' },
          Tables: { AddOrUpdateBehavior: 'MergeNewColumns' },
        },
        Grouping: {
          TableGroupingPolicy: 'CombineCompatibleSchemas',
        },
      }),
    });

    // Ensure crawler depends on the manual table
    this.rawDataCrawler.addDependency(rawDataTable);

    // Upload ETL script to S3
    const etlScriptAsset = new cdk.aws_s3_assets.Asset(this, 'ETLScriptAsset', {
      path: path.join(__dirname, '../glue-scripts/switchbot_etl_job.py'),
    });

    // IAM Role for Glue ETL Job
    this.glueJobRole = new iam.Role(this, 'SwitchBotGlueJobRole', {
      assumedBy: new iam.ServicePrincipal('glue.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AWSGlueServiceRole',
        ),
      ],
    });

    // Grant S3 permissions to Glue Job
    this.rawDataBucket.grantRead(this.glueJobRole);
    this.curatedDataBucket.grantReadWrite(this.glueJobRole);
    this.scriptsBucket.grantRead(this.glueJobRole);
    etlScriptAsset.grantRead(this.glueJobRole);

    // Glue ETL Job
    this.etlJob = new glue.CfnJob(this, 'SwitchBotETLJob', {
      name: 'switchbot-etl-job',
      role: this.glueJobRole.roleArn,
      command: {
        name: 'glueetl',
        scriptLocation: etlScriptAsset.s3ObjectUrl,
        pythonVersion: '3',
      },
      defaultArguments: {
        '--job-language': 'python',
        '--job-bookmark-option': 'job-bookmark-enable',
        '--enable-metrics': 'true',
        '--enable-continuous-cloudwatch-log': 'true',
        '--raw_bucket': this.rawDataBucket.bucketName,
        '--curated_bucket': this.curatedDataBucket.bucketName,
        '--database_name': 'switchbot_data_catalog',
      },
      description: 'ETL job to convert SwitchBot JSON data to Parquet format',
      glueVersion: '4.0',
      maxRetries: 1,
      timeout: 60, // 60 minutes
      workerType: 'G.1X',
      numberOfWorkers: 2,
    });

    // Curated Data Crawler for Parquet files in Curated S3 Bucket
    this.curatedDataCrawler = new glue.CfnCrawler(
      this,
      'SwitchBotCuratedDataCrawler',
      {
        role: this.glueCrawlerRole.roleArn,
        databaseName: 'switchbot_data_catalog',
        targets: {
          s3Targets: [
            {
              path: `s3://${this.curatedDataBucket.bucketName}/curated-data/`,
            },
          ],
        },
        name: 'switchbot-curated-data-crawler',
        description: 'Crawler for SwitchBot curated Parquet data in S3',
        tablePrefix: 'curated_switchbot_',
        schedule: {
          scheduleExpression: 'cron(0 3 * * ? *)', // Daily at 3 AM UTC (after ETL job)
        },
        schemaChangePolicy: {
          updateBehavior: 'UPDATE_IN_DATABASE',
          deleteBehavior: 'LOG',
        },
        configuration: JSON.stringify({
          Version: 1.0,
          CrawlerOutput: {
            Partitions: { AddOrUpdateBehavior: 'InheritFromTable' },
            Tables: { AddOrUpdateBehavior: 'MergeNewColumns' },
          },
          Grouping: {
            TableGroupingPolicy: 'CombineCompatibleSchemas',
          },
        }),
      },
    );

    // Ensure curated crawler depends on database
    this.curatedDataCrawler.addDependency(this.glueDatabase);

    // Output important values
    new cdk.CfnOutput(this, 'RawDataBucketName', {
      value: this.rawDataBucket.bucketName,
      description: 'Name of the S3 bucket for raw data',
    });

    new cdk.CfnOutput(this, 'CuratedDataBucketName', {
      value: this.curatedDataBucket.bucketName,
      description: 'Name of the S3 bucket for curated data',
    });

    new cdk.CfnOutput(this, 'LambdaFunctionName', {
      value: this.dataCollectionLambda.functionName,
      description: 'Name of the data collection Lambda function',
    });

    new cdk.CfnOutput(this, 'LambdaFunctionArn', {
      value: this.dataCollectionLambda.functionArn,
      description: 'ARN of the data collection Lambda function',
    });

    new cdk.CfnOutput(this, 'ScheduleName', {
      value: 'SwitchBotDataCollectionScheduler',
      description: 'Name of the EventBridge Scheduler for scheduled execution',
    });

    new cdk.CfnOutput(this, 'GlueDatabaseName', {
      value: 'switchbot_data_catalog',
      description: 'Name of the Glue Database for data catalog',
    });

    new cdk.CfnOutput(this, 'RawDataCrawlerName', {
      value: this.rawDataCrawler.name || 'switchbot-raw-data-crawler',
      description: 'Name of the Glue Crawler for raw data',
    });

    new cdk.CfnOutput(this, 'ETLJobName', {
      value: this.etlJob.name || 'switchbot-etl-job',
      description: 'Name of the Glue ETL Job',
    });

    new cdk.CfnOutput(this, 'CuratedDataCrawlerName', {
      value: this.curatedDataCrawler.name || 'switchbot-curated-data-crawler',
      description: 'Name of the Glue Crawler for curated data',
    });
  }
}
