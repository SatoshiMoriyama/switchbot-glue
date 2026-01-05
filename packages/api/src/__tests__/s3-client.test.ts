import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { S3DataStorage } from '../s3-client';

// Mock S3Client
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({
    send: jest.fn(),
  })),
  PutObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

describe('S3DataStorage', () => {
  let storage: S3DataStorage;
  let mockSend: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create a mock send function
    mockSend = jest.fn();

    // Mock S3Client constructor to return an object with our mock send function
    (S3Client as jest.MockedClass<typeof S3Client>).mockImplementation(
      () =>
        ({
          send: mockSend,
        }) as any,
    );

    storage = new S3DataStorage({
      bucketName: 'test-bucket',
      region: 'us-east-1',
    });
  });

  test('should create storage client with correct configuration', () => {
    expect(storage).toBeInstanceOf(S3DataStorage);
    expect(S3Client).toHaveBeenCalledWith({
      region: 'us-east-1',
    });
  });

  test('should successfully save raw data to S3', async () => {
    const mockApiResponse = {
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
      },
      message: 'success',
    };

    mockSend.mockResolvedValueOnce({});

    const result = await storage.saveRawData(
      mockApiResponse,
      'test-request-id',
    );

    expect(result).toMatch(
      /^year=\d{4}\/month=\d{2}\/day=\d{2}\/hour=\d{2}\/switchbot-raw-data-.*\.json$/,
    );
    expect(mockSend).toHaveBeenCalledTimes(1);

    const putObjectCommand = mockSend.mock.calls[0][0];
    expect(putObjectCommand.input).toBeDefined();
  });

  test('should generate correct S3 key with partitioning', async () => {
    const mockApiResponse = { statusCode: 100, body: {}, message: 'success' };
    mockSend.mockResolvedValueOnce({});

    // Mock Date to get predictable timestamp
    const mockDate = new Date('2024-01-06T10:30:00.000Z');
    jest.spyOn(global, 'Date').mockImplementation(() => mockDate);

    const result = await storage.saveRawData(
      mockApiResponse,
      'test-request-id',
    );

    expect(result).toMatch(
      /^year=2024\/month=01\/day=06\/hour=10\/switchbot-raw-data-.*\.json$/,
    );

    // Restore Date
    jest.restoreAllMocks();
  });

  test('should handle S3 save errors', async () => {
    const mockApiResponse = { statusCode: 100, body: {}, message: 'success' };
    mockSend.mockRejectedValueOnce(new Error('S3 error'));

    await expect(
      storage.saveRawData(mockApiResponse, 'test-request-id'),
    ).rejects.toThrow('S3 save operation failed: S3 error');
  });

  test('should include proper metadata in S3 object', async () => {
    const mockApiResponse = { statusCode: 100, body: {}, message: 'success' };
    mockSend.mockResolvedValueOnce({});

    await storage.saveRawData(mockApiResponse, 'test-request-id');

    const putObjectCommand = mockSend.mock.calls[0][0];

    // Check that the command has the expected structure
    expect(putObjectCommand.input).toBeDefined();
    expect(putObjectCommand.input.Bucket).toBe('test-bucket');
    expect(putObjectCommand.input.ContentType).toBe('application/json');
    expect(putObjectCommand.input.Metadata).toMatchObject({
      'api-version': 'v1.1',
      'lambda-request-id': 'test-request-id',
    });
    expect(putObjectCommand.input.Metadata['collection-time']).toBeDefined();
  });
});
