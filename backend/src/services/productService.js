import { query } from '../config/database.js';

/**
 * Get all products for a user
 */
export const getUserProducts = async (userId) => {
  const result = await query(
    `SELECT p.id, p.name, p.description, p.price, p.image_url, p.image_media_id, 
            p.sku, p.stock_quantity, p.status, p.created_at, p.updated_at,
            m.s3_url as image_url_from_media
     FROM products p
     LEFT JOIN media m ON p.image_media_id = m.id
     WHERE p.user_id = $1
     ORDER BY p.created_at DESC`,
    [userId]
  );

  return result.rows.map(row => ({
    id: row.id,
    name: row.name,
    description: row.description,
    price: row.price ? parseFloat(row.price) : null,
    imageUrl: row.image_url_from_media || row.image_url,
    imageMediaId: row.image_media_id,
    sku: row.sku,
    stockQuantity: row.stock_quantity,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
};

/**
 * Get product by ID
 */
export const getProductById = async (userId, productId) => {
  const result = await query(
    `SELECT p.id, p.name, p.description, p.price, p.image_url, p.image_media_id, 
            p.sku, p.stock_quantity, p.status, p.created_at, p.updated_at,
            m.s3_url as image_url_from_media
     FROM products p
     LEFT JOIN media m ON p.image_media_id = m.id
     WHERE p.id = $1 AND p.user_id = $2`,
    [productId, userId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    price: row.price ? parseFloat(row.price) : null,
    imageUrl: row.image_url_from_media || row.image_url,
    imageMediaId: row.image_media_id,
    sku: row.sku,
    stockQuantity: row.stock_quantity,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

/**
 * Create a product
 */
export const createProduct = async (userId, productData) => {
  const {
    name,
    description,
    price,
    imageUrl,
    imageMediaId,
    sku,
    stockQuantity,
    status = 'active',
  } = productData;

  if (!name) {
    throw new Error('Product name is required');
  }

  const result = await query(
    `INSERT INTO products (user_id, name, description, price, image_url, image_media_id, sku, stock_quantity, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, name, description, price, image_url, image_media_id, sku, stock_quantity, status, created_at, updated_at`,
    [
      userId,
      name,
      description || null,
      price || null,
      imageUrl || null,
      imageMediaId || null,
      sku || null,
      stockQuantity || 0,
      status,
    ]
  );

  const row = result.rows[0];
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    price: row.price ? parseFloat(row.price) : null,
    imageUrl: row.image_url,
    imageMediaId: row.image_media_id,
    sku: row.sku,
    stockQuantity: row.stock_quantity,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

/**
 * Update a product
 */
export const updateProduct = async (userId, productId, productData) => {
  const {
    name,
    description,
    price,
    imageUrl,
    imageMediaId,
    sku,
    stockQuantity,
    status,
  } = productData;

  // Build update query dynamically
  const updates = [];
  const values = [];
  let paramCount = 1;

  if (name !== undefined) {
    updates.push(`name = $${paramCount++}`);
    values.push(name);
  }
  if (description !== undefined) {
    updates.push(`description = $${paramCount++}`);
    values.push(description);
  }
  if (price !== undefined) {
    updates.push(`price = $${paramCount++}`);
    values.push(price);
  }
  if (imageUrl !== undefined) {
    updates.push(`image_url = $${paramCount++}`);
    values.push(imageUrl);
  }
  if (imageMediaId !== undefined) {
    updates.push(`image_media_id = $${paramCount++}`);
    values.push(imageMediaId);
  }
  if (sku !== undefined) {
    updates.push(`sku = $${paramCount++}`);
    values.push(sku);
  }
  if (stockQuantity !== undefined) {
    updates.push(`stock_quantity = $${paramCount++}`);
    values.push(stockQuantity);
  }
  if (status !== undefined) {
    updates.push(`status = $${paramCount++}`);
    values.push(status);
  }

  if (updates.length === 0) {
    throw new Error('No fields to update');
  }

  updates.push(`updated_at = CURRENT_TIMESTAMP`);
  values.push(userId, productId);

  const result = await query(
    `UPDATE products 
     SET ${updates.join(', ')}
     WHERE user_id = $${paramCount++} AND id = $${paramCount++}
     RETURNING id, name, description, price, image_url, image_media_id, sku, stock_quantity, status, created_at, updated_at`,
    values
  );

  if (result.rows.length === 0) {
    throw new Error('Product not found');
  }

  const row = result.rows[0];
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    price: row.price ? parseFloat(row.price) : null,
    imageUrl: row.image_url,
    imageMediaId: row.image_media_id,
    sku: row.sku,
    stockQuantity: row.stock_quantity,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

/**
 * Delete a product
 */
export const deleteProduct = async (userId, productId) => {
  const result = await query(
    'DELETE FROM products WHERE id = $1 AND user_id = $2 RETURNING id',
    [productId, userId]
  );

  if (result.rows.length === 0) {
    throw new Error('Product not found');
  }

  return { success: true };
};
