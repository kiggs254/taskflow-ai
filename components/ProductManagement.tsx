import React, { useState, useEffect } from 'react';
import { Plus, Edit, Trash2, X, Save, Image as ImageIcon, Package } from 'lucide-react';
import { api } from '../services/apiService';
import { MediaLibrary } from './MediaLibrary';

interface Product {
  id: number;
  name: string;
  description?: string;
  price?: number;
  imageUrl?: string;
  imageMediaId?: number;
  sku?: string;
  stockQuantity: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface Media {
  id: number;
  url: string;
  originalFilename: string;
}

export const ProductManagement: React.FC<{ token: string }> = ({ token }) => {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showMediaLibrary, setShowMediaLibrary] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    price: '',
    imageUrl: '',
    imageMediaId: null as number | null,
    sku: '',
    stockQuantity: '0',
    status: 'active',
  });

  useEffect(() => {
    loadProducts();
  }, [token]);

  const loadProducts = async () => {
    try {
      setLoading(true);
      const data = await api.products.list(token);
      setProducts(data);
    } catch (error) {
      console.error('Failed to load products:', error);
      alert('Failed to load products');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.name.trim()) {
      alert('Product name is required');
      return;
    }

    try {
      const productData = {
        name: formData.name,
        description: formData.description || undefined,
        price: formData.price ? parseFloat(formData.price) : undefined,
        imageUrl: formData.imageUrl || undefined,
        imageMediaId: formData.imageMediaId || undefined,
        sku: formData.sku || undefined,
        stockQuantity: parseInt(formData.stockQuantity) || 0,
        status: formData.status,
      };

      if (editingProduct) {
        await api.products.update(token, editingProduct.id, productData);
      } else {
        await api.products.create(token, productData);
      }

      resetForm();
      loadProducts();
    } catch (error: any) {
      console.error('Failed to save product:', error);
      alert(error.message || 'Failed to save product');
    }
  };

  const handleEdit = (product: Product) => {
    setEditingProduct(product);
    setFormData({
      name: product.name,
      description: product.description || '',
      price: product.price?.toString() || '',
      imageUrl: product.imageUrl || '',
      imageMediaId: product.imageMediaId || null,
      sku: product.sku || '',
      stockQuantity: product.stockQuantity.toString(),
      status: product.status,
    });
    setShowForm(true);
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this product?')) return;

    try {
      await api.products.delete(token, id);
      loadProducts();
    } catch (error) {
      console.error('Failed to delete product:', error);
      alert('Failed to delete product');
    }
  };

  const handleSelectMedia = (media: Media) => {
    setFormData(prev => ({
      ...prev,
      imageUrl: media.url,
      imageMediaId: media.id,
    }));
    setShowMediaLibrary(false);
  };

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      price: '',
      imageUrl: '',
      imageMediaId: null,
      sku: '',
      stockQuantity: '0',
      status: 'active',
    });
    setEditingProduct(null);
    setShowForm(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-slate-400">Loading products...</div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
          <Package className="w-6 h-6" />
          Products
        </h2>
        <button
          onClick={() => {
            resetForm();
            setShowForm(true);
          }}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white hover:bg-blue-600 transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Product
        </button>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-slate-800 border-b border-slate-700 p-4 flex items-center justify-between">
              <h3 className="text-xl font-bold text-white">
                {editingProduct ? 'Edit Product' : 'New Product'}
              </h3>
              <button
                onClick={resetForm}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  Product Name *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 text-white border border-slate-700 focus:border-primary focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  Description
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 text-white border border-slate-700 focus:border-primary focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">
                    Price
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.price}
                    onChange={(e) => setFormData(prev => ({ ...prev, price: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 text-white border border-slate-700 focus:border-primary focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">
                    Stock Quantity
                  </label>
                  <input
                    type="number"
                    value={formData.stockQuantity}
                    onChange={(e) => setFormData(prev => ({ ...prev, stockQuantity: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 text-white border border-slate-700 focus:border-primary focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">
                    SKU
                  </label>
                  <input
                    type="text"
                    value={formData.sku}
                    onChange={(e) => setFormData(prev => ({ ...prev, sku: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 text-white border border-slate-700 focus:border-primary focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">
                    Status
                  </label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData(prev => ({ ...prev, status: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 text-white border border-slate-700 focus:border-primary focus:outline-none"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="draft">Draft</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  Product Image
                </label>
                <div className="flex items-center gap-3">
                  {formData.imageUrl && (
                    <div className="relative w-24 h-24 rounded-lg overflow-hidden border border-slate-700">
                      <img src={formData.imageUrl} alt="Product" className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() => setFormData(prev => ({ ...prev, imageUrl: '', imageMediaId: null }))}
                        className="absolute top-1 right-1 p-1 bg-red-600 hover:bg-red-700 rounded text-white"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowMediaLibrary(true)}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors"
                  >
                    <ImageIcon className="w-4 h-4" />
                    {formData.imageUrl ? 'Change Image' : 'Select Image'}
                  </button>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-700">
                <button
                  type="button"
                  onClick={resetForm}
                  className="px-4 py-2 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white hover:bg-blue-600 transition-colors"
                >
                  <Save className="w-4 h-4" />
                  {editingProduct ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showMediaLibrary && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
          <div className="bg-slate-800 rounded-lg max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="sticky top-0 bg-slate-800 border-b border-slate-700 p-4 flex items-center justify-between">
              <h3 className="text-xl font-bold text-white">Select Image</h3>
              <button
                onClick={() => setShowMediaLibrary(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <MediaLibrary
                token={token}
                onSelect={handleSelectMedia}
                selectionMode={true}
              />
            </div>
          </div>
        </div>
      )}

      {products.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <Package className="w-16 h-16 mx-auto mb-4 opacity-50" />
          <p>No products yet. Create your first product!</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {products.map((product) => (
            <div key={product.id} className="bg-slate-800 rounded-lg overflow-hidden border border-slate-700">
              {product.imageUrl && (
                <div className="aspect-video relative">
                  <img
                    src={product.imageUrl}
                    alt={product.name}
                    className="w-full h-full object-cover"
                  />
                </div>
              )}
              <div className="p-4">
                <h3 className="text-lg font-semibold text-white mb-2">{product.name}</h3>
                {product.description && (
                  <p className="text-sm text-slate-400 mb-3 line-clamp-2">{product.description}</p>
                )}
                <div className="flex items-center justify-between text-sm text-slate-500 mb-4">
                  {product.price && <span>${product.price.toFixed(2)}</span>}
                  {product.sku && <span>SKU: {product.sku}</span>}
                  <span className={`px-2 py-1 rounded text-xs ${
                    product.status === 'active' ? 'bg-green-900/30 text-green-400' :
                    product.status === 'inactive' ? 'bg-red-900/30 text-red-400' :
                    'bg-slate-700 text-slate-400'
                  }`}>
                    {product.status}
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleEdit(product)}
                    className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors"
                  >
                    <Edit className="w-4 h-4" />
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(product.id)}
                    className="px-3 py-2 rounded-lg bg-red-900/30 text-red-400 hover:bg-red-900/50 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
