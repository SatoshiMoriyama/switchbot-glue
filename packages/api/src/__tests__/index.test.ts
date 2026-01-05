import type { APIGatewayProxyEvent, Context } from 'aws-lambda';
import { handler } from '../index';

// Mock the SwitchBot client
jest.mock('../switchbot-client');
jest.mock('../s3-client');

import { S3DataStorage } from '../s3-client';
import { SwitchBotClient } from '../switchbot-client';

const mockSwitchBotClient = SwitchBotClient as jest.MockedClass<
  typeof SwitchBotClient
>;
const mockS3DataStorage = S3DataStorage as jest.MockedClass<
  typeof S3DataStorage
>;

describe('Lambda Handler', () => {
  let mockEvent: APIGatewayProxyEvent;
  let mockContext: Context;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Mock event
    mockEvent = {
      body: null,
      headers: {},
      multiValueHeaders: {},
      httpMethod: 'GET',
      isBase64Encoded: false,
      path: '/test',
      pathParameters: null,
      queryStringParameters: null,
      multiValueQueryStringParameters: null,
      stageVariables: null,
      requestContext: {} as any,
      resource: '',
    };

    // Mock context
    mockContext = {
      callbackWaitsForEmptyEventLoop: false,
      functionName: 'test-function',
      functionVersion: '1',
      invokedFunctionArn:
        'arn:aws:lambda:us-east-1:123456789012:function:test-function',
      memoryLimitInMB: '128',
      awsRequestId: 'test-request-id',
      logGroupName: '/aws/lambda/test-function',
      logStreamName: '2024/01/06/[$LATEST]test-stream',
      getRemainingTimeInMillis: () => 30000,
      done: jest.fn(),
      fail: jest.fn(),
      succeed: jest.fn(),
    };

    // Mock SwitchBot client
    const mockGetDevices = jest.fn().mockResolvedValue({
      statusCode: 100,
      body: {
        devices: [
          {
            deviceId: 'test-device-1',
            deviceName: 'Test Device',
            deviceType: 'Humidifier',
            enableCloudService: true,
          },
        ],
        infraredRemoteList: [],
      },
      message: 'success',
    });

    mockSwitchBotClient.prototype.getDevices = mockGetDevices;

    // Mock S3 storage
    const mockSaveRawData = jest.fn().mockResolvedValue('test-s3-key');
    mockS3DataStorage.prototype.saveRawData = mockSaveRawData;
  });

  test('should successfully process SwitchBot data and save to S3', async () => {
    const result = await handler(mockEvent, mockContext);

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toMatchObject({
      message: 'SwitchBot data collection completed successfully',
      requestId: 'test-request-id',
      apiStatus: 100,
      deviceCount: 1,
      infraredRemoteCount: 0,
    });

    // Verify SwitchBot client was called
    expect(mockSwitchBotClient.prototype.getDevices).toHaveBeenCalledTimes(1);

    // Verify S3 storage was called
    expect(mockS3DataStorage.prototype.saveRawData).toHaveBeenCalledTimes(1);
  });

  test('should handle missing environment variables', async () => {
    // Temporarily remove environment variable
    const originalToken = process.env.SWITCHBOT_TOKEN;
    delete process.env.SWITCHBOT_TOKEN;

    const result = await handler(mockEvent, mockContext);

    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body)).toMatchObject({
      message: 'SwitchBot data collection failed',
      error: 'Missing required environment variables: SWITCHBOT_TOKEN',
    });

    // Restore environment variable
    process.env.SWITCHBOT_TOKEN = originalToken;
  });

  test('should handle SwitchBot API errors', async () => {
    // Mock API error
    mockSwitchBotClient.prototype.getDevices = jest
      .fn()
      .mockRejectedValue(new Error('API connection failed'));

    const result = await handler(mockEvent, mockContext);

    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body)).toMatchObject({
      message: 'SwitchBot data collection failed',
      error: 'API connection failed',
    });
  });

  test('should handle S3 save errors', async () => {
    // Mock S3 error
    mockS3DataStorage.prototype.saveRawData = jest
      .fn()
      .mockRejectedValue(new Error('S3 save failed'));

    const result = await handler(mockEvent, mockContext);

    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body)).toMatchObject({
      message: 'SwitchBot data collection failed',
      error: 'S3 save failed',
    });
  });
});
