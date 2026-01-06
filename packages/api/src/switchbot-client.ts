import * as crypto from 'node:crypto';

/**
 * SwitchBot API Response interface
 */
export interface SwitchBotApiResponse {
  statusCode: number;
  body: {
    deviceList?: Device[];
    infraredRemoteList?: InfraredRemote[];
    message?: string;
    // Device status fields for temperature/humidity sensors
    deviceId?: string;
    deviceType?: string;
    temperature?: number;
    humidity?: number;
    battery?: number;
    version?: string;
    hubDeviceId?: string;
  };
  message: string;
}

/**
 * Device interface
 */
export interface Device {
  deviceId: string;
  deviceName: string;
  deviceType: string;
  enableCloudService: boolean;
  hubDeviceId?: string;
}

/**
 * Infrared Remote interface
 */
export interface InfraredRemote {
  deviceId: string;
  deviceName: string;
  remoteType: string;
  hubDeviceId: string;
}

/**
 * SwitchBot API Client configuration
 */
export interface SwitchBotClientConfig {
  token: string;
  secret: string;
  baseUrl?: string;
}

/**
 * SwitchBot API Client
 * Handles authentication and communication with SwitchBot API
 */
export class SwitchBotClient {
  private readonly token: string;
  private readonly secret: string;
  private readonly baseUrl: string;

  constructor(config: SwitchBotClientConfig) {
    this.token = config.token;
    this.secret = config.secret;
    this.baseUrl = config.baseUrl || 'https://api.switch-bot.com';
  }

  /**
   * Generate authentication headers for SwitchBot API requests
   * @returns Headers object with authentication information
   */
  private generateAuthHeaders(): Record<string, string> {
    const t = Date.now();
    const nonce = 'requestID';
    const data = this.token + t + nonce;
    const sign = crypto
      .createHmac('sha256', this.secret)
      .update(data)
      .digest('base64')
      .toUpperCase();

    return {
      Authorization: this.token, // No Bearer prefix needed
      sign: sign,
      nonce: nonce,
      t: t.toString(),
      'Content-Type': 'application/json',
    };
  }

  /**
   * Send HTTPS request to SwitchBot API
   * @param endpoint - API endpoint path
   * @param method - HTTP method (default: GET)
   * @returns Promise resolving to API response
   */
  private async sendRequest(
    endpoint: string,
    method: string = 'GET',
  ): Promise<SwitchBotApiResponse> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = this.generateAuthHeaders();

    try {
      const response = await fetch(url, {
        method,
        headers,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return data as SwitchBotApiResponse;
    } catch (error) {
      console.error('SwitchBot API request failed:', error);
      throw new Error(
        `SwitchBot API request failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Get list of devices from SwitchBot API
   * @returns Promise resolving to device list response
   */
  async getDevices(): Promise<SwitchBotApiResponse> {
    return this.sendRequest('/v1.1/devices');
  }

  /**
   * Get device status from SwitchBot API
   * @param deviceId - Device ID to get status for
   * @returns Promise resolving to device status response
   */
  async getDeviceStatus(deviceId: string): Promise<SwitchBotApiResponse> {
    return this.sendRequest(`/v1.1/devices/${deviceId}/status`);
  }
}
