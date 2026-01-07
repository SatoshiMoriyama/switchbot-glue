import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { SwitchBotDataPipelineStack } from '../lib/cdk-stack';

test('SwitchBot Data Pipeline Stack Created', () => {
  const app = new cdk.App();
  // WHEN
  const stack = new SwitchBotDataPipelineStack(app, 'MyTestStack');
  // THEN
  const template = Template.fromStack(stack);

  // Basic test to ensure stack can be created without errors
  expect(template).toBeDefined();
});
