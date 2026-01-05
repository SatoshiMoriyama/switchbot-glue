// Jest setup file
// Mock AWS SDK to avoid actual AWS calls during testing
jest.mock('@aws-sdk/client-s3');

// Set up environment variables for testing
process.env.SWITCHBOT_TOKEN = 'test-token';
process.env.SWITCHBOT_SECRET = 'test-secret';
process.env.S3_RAW_BUCKET = 'test-bucket';
process.env.AWS_REGION = 'us-east-1';
