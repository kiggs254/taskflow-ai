import express from 'express';
import multer from 'multer';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import {
  getUserMedia,
  uploadMedia,
  deleteMedia,
  getMediaById,
} from '../services/mediaService.js';

const router = express.Router();

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Allow images and common file types
    const allowedMimes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/svg+xml',
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only images are allowed.'), false);
    }
  },
});

/**
 * GET /api/media
 * Get all media for the authenticated user
 */
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const { limit = 100, offset = 0 } = req.query;
  const media = await getUserMedia(req.user.id, parseInt(limit), parseInt(offset));
  res.json(media);
}));

/**
 * GET /api/media/:id
 * Get a specific media item
 */
router.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const media = await getMediaById(req.user.id, parseInt(req.params.id));
  if (!media) {
    return res.status(404).json({ error: 'Media not found' });
  }
  res.json(media);
}));

/**
 * POST /api/media/upload
 * Upload a new media file
 */
router.post('/upload', authenticate, upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const media = await uploadMedia(req.user.id, req.file);
  res.json(media);
}));

/**
 * DELETE /api/media/:id
 * Delete a media file
 */
router.delete('/:id', authenticate, asyncHandler(async (req, res) => {
  await deleteMedia(req.user.id, parseInt(req.params.id));
  res.json({ success: true });
}));

export default router;
