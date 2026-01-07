import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { toZonedTime } from 'date-fns-tz';

/**
 * S3 Data Storage interface
 */
export interface S3StorageConfig {
  bucketName: string;
  region?: string;
}

/**
 * Raw data structure for S3 storage
 */
export interface RawDataRecord {
  timestamp: string;
  api_response: any;
  metadata: {
    collection_time: string;
    api_version: string;
    lambda_request_id: string;
  };
}

/**
 * S3 Data Storage Client
 * Handles saving data to S3 with proper naming and structure
 */
export class S3DataStorage {
  private readonly s3Client: S3Client;
  private readonly bucketName: string;

  constructor(config: S3StorageConfig) {
    this.bucketName = config.bucketName;
    this.s3Client = new S3Client({
      region: config.region || process.env.AWS_REGION || 'us-east-1',
    });
  }

  /**
   * Generate S3 key with timestamp and partitioning (JST timezone)
   * @param timestamp - ISO timestamp string
   * @returns S3 key path with partitioning based on JST
   */
  private generateS3Key(timestamp: string): string {
    const date = new Date(timestamp);

    // Convert UTC to JST using proper timezone handling
    const jstDate = toZonedTime(date, 'Asia/Tokyo');

    const year = jstDate.getFullYear();
    const month = String(jstDate.getMonth() + 1).padStart(2, '0');
    const day = String(jstDate.getDate()).padStart(2, '0');
    const hour = String(jstDate.getHours()).padStart(2, '0');

    const timestampForFile = timestamp.replace(/[:.]/g, '-');
    return `year=${year}/month=${month}/day=${day}/hour=${hour}/switchbot-raw-data-${timestampForFile}.json`;
  }

  /**
   * Save raw data to S3 with timestamp and metadata
   * @param apiResponse - Response from SwitchBot API
   * @param requestId - Lambda request ID for tracking
   * @returns Promise resolving to S3 key where data was saved
   */
  async saveRawData(apiResponse: any, requestId: string): Promise<string> {
    const timestamp = new Date().toISOString();

    const rawData: RawDataRecord = {
      timestamp,
      api_response: apiResponse,
      metadata: {
        collection_time: timestamp,
        api_version: 'v1.1',
        lambda_request_id: requestId,
      },
    };

    const s3Key = this.generateS3Key(timestamp);

    try {
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: s3Key,
        Body: JSON.stringify(rawData), // コンパクトなJSON形式（インデントなし）
        ContentType: 'application/json',
        Metadata: {
          'collection-time': timestamp,
          'api-version': 'v1.1',
          'lambda-request-id': requestId,
        },
      });

      await this.s3Client.send(command);
      console.log(
        `Data saved successfully to S3: s3://${this.bucketName}/${s3Key}`,
      );
      return s3Key;
    } catch (error) {
      console.error('Failed to save data to S3:', error);
      throw new Error(
        `S3 save operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }
}
