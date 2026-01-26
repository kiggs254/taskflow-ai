import { query } from '../config/database.js';
import { uploadToS3, deleteFromS3 } from './s3Service.js';

// Try to import sharp, but make it optional
let sharp;
try {
  const sharpModule = await import('sharp');
  sharp = sharpModule.default || sharpModule;
} catch (error) {
  console.warn('Sharp not available, image dimensions will not be extracted');
}

/**
 * Get all media for a user
 */
export const getUserMedia = async (userId, limit = 100, offset = 0) => {
  const result = await query(
    `SELECT id, filename, original_filename, s3_url, mime_type, file_size, width, height, created_at
     FROM media
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );

  return result.rows.map(row => ({
    id: row.id,
    filename: row.filename,
    originalFilename: row.original_filename,
    url: row.s3_url,
    mimeType: row.mime_type,
    fileSize: row.file_size,
    width: row.width,
    height: row.height,
    createdAt: row.created_at,
  }));
};

/**
 * Upload media file
 */
export const uploadMedia = async (userId, file) => {
  // Upload to S3
  const { s3Key, s3Url } = await uploadToS3(file, userId);

  // Get image dimensions if it's an image
  let width = null;
  let height = null;
  if (file.mimetype.startsWith('image/') && sharp) {
    try {
      const metadata = await sharp(file.buffer).metadata();
      width = metadata.width;
      height = metadata.height;
    } catch (error) {
      console.error('Error getting image dimensions:', error);
    }
  }

  // Save to database
  const result = await query(
    `INSERT INTO media (user_id, filename, original_filename, s3_key, s3_url, mime_type, file_size, width, height)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, filename, original_filename, s3_url, mime_type, file_size, width, height, created_at`,
    [
      userId,
      file.filename || file.originalname,
      file.originalname,
      s3Key,
      s3Url,
      file.mimetype,
      file.size,
      width,
      height,
    ]
  );

  const row = result.rows[0];
  return {
    id: row.id,
    filename: row.filename,
    originalFilename: row.original_filename,
    url: row.s3_url,
    mimeType: row.mime_type,
    fileSize: row.file_size,
    width: row.width,
    height: row.height,
    createdAt: row.created_at,
  };
};

/**
 * Delete media
 */
export const deleteMedia = async (userId, mediaId) => {
  // Get media record to get S3 key
  const mediaResult = await query(
    'SELECT s3_key FROM media WHERE id = $1 AND user_id = $2',
    [mediaId, userId]
  );

  if (mediaResult.rows.length === 0) {
    throw new Error('Media not found');
  }

  const s3Key = mediaResult.rows[0].s3_key;

  // Delete from S3
  await deleteFromS3(s3Key);

  // Delete from database
  await query(
    'DELETE FROM media WHERE id = $1 AND user_id = $2',
    [mediaId, userId]
  );

  return { success: true };
};

/**
 * Get media by ID
 */
export const getMediaById = async (userId, mediaId) => {
  const result = await query(
    `SELECT id, filename, original_filename, s3_url, mime_type, file_size, width, height, created_at
     FROM media
     WHERE id = $1 AND user_id = $2`,
    [mediaId, userId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    filename: row.filename,
    originalFilename: row.original_filename,
    url: row.s3_url,
    mimeType: row.mime_type,
    fileSize: row.file_size,
    width: row.width,
    height: row.height,
    createdAt: row.created_at,
  };
};
