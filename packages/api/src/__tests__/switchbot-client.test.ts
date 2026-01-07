import { SwitchBotClient } from '../switchbot-client';

// Mock fetch globally
global.fetch = jest.fn();
const mockFetch = fetch as jest.MockedFunction<typeof fetch>;

describe('SwitchBotClient', () => {
  let client: SwitchBotClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new SwitchBotClient({
      token: 'test-token',
      secret: 'test-secret',
    });
  });

  test('should create client with correct configuration', () => {
    expect(client).toBeInstanceOf(SwitchBotClient);
  });

  test('should successfully fetch devices', async () => {
    const mockResponse = {
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
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    } as Response);

    const result = await client.getDevices();

    expect(result).toEqual(mockResponse);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.switch-bot.com/v1.1/devices',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'test-token',
          'Content-Type': 'application/json',
        }),
      }),
    );
  });

  test('should handle HTTP errors', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    } as Response);

    await expect(client.getDevices()).rejects.toThrow('HTTP 401: Unauthorized');
  });

  test('should handle network errors', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    await expect(client.getDevices()).rejects.toThrow(
      'SwitchBot API request failed: Network error',
    );
  });

  test('should generate proper authentication headers', async () => {
    const mockResponse = {
      statusCode: 100,
      body: { devices: [] },
      message: 'success',
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    } as Response);

    await client.getDevices();

    const callArgs = mockFetch.mock.calls[0];
    const headers = callArgs[1]?.headers as Record<string, string>;

    expect(headers.Authorization).toBe('test-token');
    expect(headers.sign).toBeDefined();
    expect(headers.t).toBeDefined();
    expect(headers.nonce).toBeDefined();
    expect(headers['Content-Type']).toBe('application/json');
  });
});
