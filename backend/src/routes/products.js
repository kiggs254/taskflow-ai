import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import {
  getUserProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
} from '../services/productService.js';

const router = express.Router();

/**
 * GET /api/products
 * Get all products for the authenticated user
 */
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const products = await getUserProducts(req.user.id);
  res.json(products);
}));

/**
 * GET /api/products/:id
 * Get a specific product
 */
router.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const product = await getProductById(req.user.id, parseInt(req.params.id));
  if (!product) {
    return res.status(404).json({ error: 'Product not found' });
  }
  res.json(product);
}));

/**
 * POST /api/products
 * Create a new product
 */
router.post('/', authenticate, asyncHandler(async (req, res) => {
  const product = await createProduct(req.user.id, req.body);
  res.status(201).json(product);
}));

/**
 * PUT /api/products/:id
 * Update a product
 */
router.put('/:id', authenticate, asyncHandler(async (req, res) => {
  const product = await updateProduct(req.user.id, parseInt(req.params.id), req.body);
  res.json(product);
}));

/**
 * DELETE /api/products/:id
 * Delete a product
 */
router.delete('/:id', authenticate, asyncHandler(async (req, res) => {
  await deleteProduct(req.user.id, parseInt(req.params.id));
  res.json({ success: true });
}));

export default router;
