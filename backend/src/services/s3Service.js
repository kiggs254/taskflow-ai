import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config/env.js';
import crypto from 'crypto';

// Initialize S3 client
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

const BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME || '';
const BUCKET_URL = process.env.AWS_S3_BUCKET_URL || `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com`;

/**
 * Upload a file to S3
 */
export const uploadToS3 = async (file, userId) => {
  if (!BUCKET_NAME) {
    throw new Error('S3 bucket name not configured');
  }

  // Generate unique filename
  const fileExtension = file.originalname.split('.').pop();
  const uniqueFilename = `${userId}/${crypto.randomUUID()}.${fileExtension}`;

  // Upload to S3
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: uniqueFilename,
    Body: file.buffer,
    ContentType: file.mimetype,
    ACL: 'public-read', // Make files publicly accessible
  });

  await s3Client.send(command);

  // Return S3 URL
  const s3Url = `${BUCKET_URL}/${uniqueFilename}`;

  return {
    s3Key: uniqueFilename,
    s3Url,
  };
};

/**
 * Delete a file from S3
 */
export const deleteFromS3 = async (s3Key) => {
  if (!BUCKET_NAME || !s3Key) {
    return;
  }

  try {
    const command = new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
    });

    await s3Client.send(command);
  } catch (error) {
    console.error('Error deleting file from S3:', error);
    // Don't throw - file might not exist
  }
};

/**
 * Get a presigned URL for temporary access (if needed)
 */
export const getPresignedUrl = async (s3Key, expiresIn = 3600) => {
  if (!BUCKET_NAME || !s3Key) {
    return null;
  }

  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: s3Key,
  });

  return await getSignedUrl(s3Client, command, { expiresIn });
};
