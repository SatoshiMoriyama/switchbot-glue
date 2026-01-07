import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import * as glue from 'aws-cdk-lib/aws-glue';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as schedulerTargets from 'aws-cdk-lib/aws-scheduler-targets';
import type { Construct } from 'constructs';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../../../.env') });

// =============================================================================
// Constants
// =============================================================================
const GLUE_DATABASE_NAME = 'switchbot_data_catalog';
const RAW_TABLE_NAME = 'switchbot_raw_data';
const CURATED_TABLE_NAME = 'switchbot_curated_data';

export class SwitchBotDataPipelineStack extends cdk.Stack {
  // S3 Buckets
  public readonly rawDataBucket: s3.Bucket;
  public readonly curatedDataBucket: s3.Bucket;

  // Lambda
  public readonly lambdaExecutionRole: iam.Role;
  public readonly dataCollectionLambda: nodejs.NodejsFunction;

  // Glue
  public readonly glueDatabase: glue.CfnDatabase;
  public readonly glueCrawlerRole: iam.Role;
  public readonly glueJobRole: iam.Role;
  public readonly rawDataCrawler: glue.CfnCrawler;
  public readonly curatedDataCrawler: glue.CfnCrawler;
  public readonly etlJob: glue.CfnJob;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Validate environment variables
    const switchbotToken = process.env.SWITCHBOT_TOKEN;
    const switchbotSecret = process.env.SWITCHBOT_SECRET;
    if (!switchbotToken || !switchbotSecret) {
      throw new Error(
        'SWITCHBOT_TOKEN and SWITCHBOT_SECRET must be set in .env file',
      );
    }

    // =========================================================================
    // 1. S3 Buckets - Data Storage Layer
    // =========================================================================
    this.rawDataBucket = new s3.Bucket(this, 'SwitchBotRawDataBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.curatedDataBucket = new s3.Bucket(this, 'SwitchBotCuratedDataBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // =========================================================================
    // 2. Lambda - Data Collection Layer
    // =========================================================================
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
    this.rawDataBucket.grantReadWrite(this.lambdaExecutionRole);

    const lambdaLogGroup = new logs.LogGroup(this, 'SwitchBotLambdaLogGroup', {
      logGroupName: '/aws/lambda/SwitchBotDataCollectionFunction',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.dataCollectionLambda = new nodejs.NodejsFunction(
      this,
      'SwitchBotDataCollectionFunction',
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        entry: path.join(__dirname, '../../api/src/index.ts'),
        handler: 'handler',
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

    new scheduler.Schedule(this, 'SwitchBotDataCollectionScheduler', {
      schedule: scheduler.ScheduleExpression.rate(cdk.Duration.minutes(15)),
      target: new schedulerTargets.LambdaInvoke(this.dataCollectionLambda, {}),
      description: 'Triggers SwitchBot data collection every 15 minutes',
    });

    // =========================================================================
    // 3. Glue Database & Tables - Data Catalog Layer
    // =========================================================================
    this.glueDatabase = new glue.CfnDatabase(this, 'SwitchBotGlueDatabase', {
      catalogId: this.account,
      databaseInput: {
        name: GLUE_DATABASE_NAME,
        description: 'Database for SwitchBot temperature and humidity data',
      },
    });

    const rawDataTable = new glue.CfnTable(this, 'SwitchBotRawDataTable', {
      catalogId: this.account,
      databaseName: GLUE_DATABASE_NAME,
      tableInput: {
        name: RAW_TABLE_NAME,
        description: 'SwitchBot raw JSON data table',
        tableType: 'EXTERNAL_TABLE',
        parameters: { classification: 'json', compressionType: 'none' },
        storageDescriptor: {
          location: `s3://${this.rawDataBucket.bucketName}/`,
          inputFormat: 'org.apache.hadoop.mapred.TextInputFormat',
          outputFormat:
            'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat',
          serdeInfo: {
            serializationLibrary: 'org.openx.data.jsonserde.JsonSerDe',
          },
          columns: [],
        },
      },
    });
    rawDataTable.addDependency(this.glueDatabase);

    const curatedDataTable = new glue.CfnTable(
      this,
      'SwitchBotCuratedDataTable',
      {
        catalogId: this.account,
        databaseName: GLUE_DATABASE_NAME,
        tableInput: {
          name: CURATED_TABLE_NAME,
          description: 'SwitchBot curated Parquet data table',
          tableType: 'EXTERNAL_TABLE',
          parameters: { classification: 'parquet', compressionType: 'none' },
          storageDescriptor: {
            location: `s3://${this.curatedDataBucket.bucketName}/curated-data/`,
            inputFormat:
              'org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat',
            outputFormat:
              'org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat',
            serdeInfo: {
              serializationLibrary:
                'org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe',
            },
            columns: [],
          },
        },
      },
    );
    curatedDataTable.addDependency(this.glueDatabase);

    // =========================================================================
    // 4. Glue Crawlers - Schema Discovery Layer
    // =========================================================================
    this.glueCrawlerRole = new iam.Role(this, 'SwitchBotGlueCrawlerRole', {
      assumedBy: new iam.ServicePrincipal('glue.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AWSGlueServiceRole',
        ),
      ],
    });
    this.rawDataBucket.grantRead(this.glueCrawlerRole);
    this.curatedDataBucket.grantRead(this.glueCrawlerRole);

    const crawlerConfig = JSON.stringify({
      Version: 1.0,
      CrawlerOutput: {
        Partitions: { AddOrUpdateBehavior: 'InheritFromTable' },
        Tables: { AddOrUpdateBehavior: 'MergeNewColumns' },
      },
      Grouping: { TableGroupingPolicy: 'CombineCompatibleSchemas' },
    });

    this.rawDataCrawler = new glue.CfnCrawler(this, 'SwitchBotRawDataCrawler', {
      role: this.glueCrawlerRole.roleArn,
      databaseName: GLUE_DATABASE_NAME,
      targets: {
        catalogTargets: [
          { databaseName: GLUE_DATABASE_NAME, tables: [RAW_TABLE_NAME] },
        ],
      },
      name: 'switchbot-raw-data-crawler',
      description: 'Crawler to update switchbot_raw_data table schema',
      tablePrefix: '',
      schedule: { scheduleExpression: 'cron(0 2 * * ? *)' },
      schemaChangePolicy: {
        updateBehavior: 'UPDATE_IN_DATABASE',
        deleteBehavior: 'LOG',
      },
      configuration: crawlerConfig,
    });
    this.rawDataCrawler.addDependency(rawDataTable);

    this.curatedDataCrawler = new glue.CfnCrawler(
      this,
      'SwitchBotCuratedDataCrawler',
      {
        role: this.glueCrawlerRole.roleArn,
        databaseName: GLUE_DATABASE_NAME,
        targets: {
          catalogTargets: [
            { databaseName: GLUE_DATABASE_NAME, tables: [CURATED_TABLE_NAME] },
          ],
        },
        name: 'switchbot-curated-data-crawler',
        description: 'Crawler to update switchbot_curated_data table schema',
        tablePrefix: '',
        schedule: { scheduleExpression: 'cron(0 3 * * ? *)' },
        schemaChangePolicy: {
          updateBehavior: 'UPDATE_IN_DATABASE',
          deleteBehavior: 'LOG',
        },
        configuration: crawlerConfig,
      },
    );
    this.curatedDataCrawler.addDependency(curatedDataTable);

    // =========================================================================
    // 5. Glue ETL Job - Data Transformation Layer
    // =========================================================================
    const etlScriptAsset = new cdk.aws_s3_assets.Asset(this, 'ETLScriptAsset', {
      path: path.join(__dirname, '../glue-scripts/switchbot_etl_job.py'),
    });

    this.glueJobRole = new iam.Role(this, 'SwitchBotGlueJobRole', {
      assumedBy: new iam.ServicePrincipal('glue.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AWSGlueServiceRole',
        ),
      ],
    });
    this.rawDataBucket.grantRead(this.glueJobRole);
    this.curatedDataBucket.grantReadWrite(this.glueJobRole);
    etlScriptAsset.grantRead(this.glueJobRole);

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
        '--database_name': GLUE_DATABASE_NAME,
      },
      description: 'ETL job to convert SwitchBot JSON data to Parquet format',
      glueVersion: '4.0',
      maxRetries: 0,
      timeout: 60,
      workerType: 'G.1X',
      numberOfWorkers: 2,
    });

    // =========================================================================
    // 6. Outputs
    // =========================================================================
    new cdk.CfnOutput(this, 'RawDataBucketName', {
      value: this.rawDataBucket.bucketName,
    });
    new cdk.CfnOutput(this, 'CuratedDataBucketName', {
      value: this.curatedDataBucket.bucketName,
    });
    new cdk.CfnOutput(this, 'LambdaFunctionName', {
      value: this.dataCollectionLambda.functionName,
    });
    new cdk.CfnOutput(this, 'LambdaFunctionArn', {
      value: this.dataCollectionLambda.functionArn,
    });
    new cdk.CfnOutput(this, 'GlueDatabaseName', {
      value: GLUE_DATABASE_NAME,
    });
    new cdk.CfnOutput(this, 'RawDataCrawlerName', {
      value: this.rawDataCrawler.name || 'switchbot-raw-data-crawler',
    });
    new cdk.CfnOutput(this, 'CuratedDataCrawlerName', {
      value: this.curatedDataCrawler.name || 'switchbot-curated-data-crawler',
    });
    new cdk.CfnOutput(this, 'ETLJobName', {
      value: this.etlJob.name || 'switchbot-etl-job',
    });
  }
}
