import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from 'aws-lambda';

import { S3DataStorage } from './s3-client';
import { type SwitchBotApiResponse, SwitchBotClient } from './switchbot-client';

/**
 * Lambda environment variables interface
 */
interface LambdaEnvironment {
  SWITCHBOT_TOKEN: string;
  SWITCHBOT_SECRET: string;
  S3_RAW_BUCKET: string;
}

/**
 * Validate required environment variables
 * @returns Validated environment configuration
 */
function validateEnvironment(): LambdaEnvironment {
  const requiredVars = ['SWITCHBOT_TOKEN', 'SWITCHBOT_SECRET', 'S3_RAW_BUCKET'];
  const missing = requiredVars.filter((varName) => !process.env[varName]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`,
    );
  }

  return {
    SWITCHBOT_TOKEN: process.env.SWITCHBOT_TOKEN as string,
    SWITCHBOT_SECRET: process.env.SWITCHBOT_SECRET as string,
    S3_RAW_BUCKET: process.env.S3_RAW_BUCKET as string,
  };
}

/**
 * Main Lambda handler for SwitchBot data collection
 * Fetches data from SwitchBot API and saves to S3 with timestamp
 */
export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context,
): Promise<APIGatewayProxyResult> => {
  console.log('SwitchBot Data Pipeline Lambda function started');
  console.log('Request ID:', context.awsRequestId);
  console.log('Event:', JSON.stringify(event, null, 2));

  try {
    // Validate environment variables
    const env = validateEnvironment();
    console.log('Environment validated successfully');

    // Initialize SwitchBot API client
    const switchBotClient = new SwitchBotClient({
      token: env.SWITCHBOT_TOKEN,
      secret: env.SWITCHBOT_SECRET,
    });

    // Initialize S3 storage client
    const s3Storage = new S3DataStorage({
      bucketName: env.S3_RAW_BUCKET,
      region: process.env.AWS_REGION || 'ap-northeast-1',
    });

    console.log('Fetching device data from SwitchBot API...');

    // Fetch device list from SwitchBot API
    const devicesResponse: SwitchBotApiResponse =
      await switchBotClient.getDevices();

    console.log('Device list received:', {
      statusCode: devicesResponse.statusCode,
      message: devicesResponse.message,
      deviceCount: devicesResponse.body.deviceList?.length || 0,
      infraredRemoteCount: devicesResponse.body.infraredRemoteList?.length || 0,
    });

    // Collect device status data for temperature/humidity sensors
    const deviceStatusData: Array<{
      deviceInfo: any;
      status: any;
      timestamp: string;
    }> = [];

    if (devicesResponse.body.deviceList) {
      for (const device of devicesResponse.body.deviceList) {
        // Get status for temperature/humidity sensors
        if (
          device.deviceType === 'MeterPro' ||
          device.deviceType === 'Meter' ||
          device.deviceType === 'MeterPlus'
        ) {
          try {
            console.log(
              `Fetching status for ${device.deviceName} (${device.deviceId})`,
            );
            const statusResponse = await switchBotClient.getDeviceStatus(
              device.deviceId,
            );

            deviceStatusData.push({
              deviceInfo: device,
              status: statusResponse.body,
              timestamp: new Date().toISOString(),
            });

            console.log(
              `Status received for ${device.deviceName}:`,
              statusResponse.body,
            );
          } catch (error) {
            console.error(
              `Failed to get status for device ${device.deviceId}:`,
              error,
            );
            // Continue with other devices even if one fails
          }
        }
      }
    }

    // Save only temperature/humidity sensor data
    const sensorData = {
      deviceStatusData: deviceStatusData,
      timestamp: new Date().toISOString(),
      summary: {
        totalDevicesScanned: devicesResponse.body.deviceList?.length || 0,
        temperatureHumidityDevicesFound: deviceStatusData.length,
        collectionTime: new Date().toISOString(),
      },
    };

    // Save sensor data to S3
    const s3Key = await s3Storage.saveRawData(
      { ...devicesResponse, body: sensorData },
      context.awsRequestId,
    );

    console.log('Data collection completed successfully');

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message:
          'SwitchBot temperature/humidity data collection completed successfully',
        timestamp: new Date().toISOString(),
        s3Key: s3Key,
        requestId: context.awsRequestId,
        temperatureHumidityDevicesCount: deviceStatusData.length,
      }),
    };
  } catch (error) {
    console.error('Lambda function failed:', error);

    // Return error response
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: 'SwitchBot data collection failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
        requestId: context.awsRequestId,
      }),
    };
  }
};
