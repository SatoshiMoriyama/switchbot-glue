import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';

export class SwitchBotDataPipelineStack extends cdk.Stack {
  public readonly rawDataBucket: s3.Bucket;
  public readonly curatedDataBucket: s3.Bucket;
  public readonly scriptsBucket: s3.Bucket;
  public readonly lambdaExecutionRole: iam.Role;

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
  }
}
