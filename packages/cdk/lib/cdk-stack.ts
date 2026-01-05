import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
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
          AWS_REGION: this.region,
        },
        description: 'Collects data from SwitchBot API and stores in S3',
      },
    );

    // Output important values
    new cdk.CfnOutput(this, 'RawDataBucketName', {
      value: this.rawDataBucket.bucketName,
      description: 'Name of the S3 bucket for raw data',
    });

    new cdk.CfnOutput(this, 'LambdaFunctionName', {
      value: this.dataCollectionLambda.functionName,
      description: 'Name of the data collection Lambda function',
    });
  }
}
