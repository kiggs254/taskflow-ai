import React, { useState, useEffect, useRef } from 'react';
import { Upload, X, Image as ImageIcon, Trash2, Check } from 'lucide-react';
import { api } from '../services/apiService';

interface Media {
  id: number;
  filename: string;
  originalFilename: string;
  url: string;
  mimeType: string;
  fileSize: number;
  width?: number;
  height?: number;
  createdAt: string;
}

interface MediaLibraryProps {
  token: string;
  onSelect?: (media: Media) => void;
  selectionMode?: boolean;
}

export const MediaLibrary: React.FC<MediaLibraryProps> = ({ token, onSelect, selectionMode = false }) => {
  const [media, setMedia] = useState<Media[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState<Media | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadMedia();
  }, [token]);

  const loadMedia = async () => {
    try {
      setLoading(true);
      const data = await api.media.list(token);
      setMedia(data);
    } catch (error) {
      console.error('Failed to load media:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      alert('Please upload an image file');
      return;
    }

    // Validate file size (10MB)
    if (file.size > 10 * 1024 * 1024) {
      alert('File size must be less than 10MB');
      return;
    }

    try {
      setUploading(true);
      const uploaded = await api.media.upload(token, file);
      setMedia(prev => [uploaded, ...prev]);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (error: any) {
      console.error('Failed to upload:', error);
      alert(error.message || 'Failed to upload file');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (mediaId: number) => {
    if (!confirm('Are you sure you want to delete this media?')) return;

    try {
      await api.media.delete(token, mediaId);
      setMedia(prev => prev.filter(m => m.id !== mediaId));
      if (selectedMedia?.id === mediaId) {
        setSelectedMedia(null);
      }
    } catch (error) {
      console.error('Failed to delete:', error);
      alert('Failed to delete media');
    }
  };

  const handleSelect = (item: Media) => {
    if (selectionMode && onSelect) {
      setSelectedMedia(item);
      onSelect(item);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-slate-400">Loading media...</div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">Media Library</h2>
        <div className="flex items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleUpload}
            className="hidden"
            id="media-upload"
          />
          <label
            htmlFor="media-upload"
            className={`flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white hover:bg-blue-600 cursor-pointer transition-colors ${
              uploading ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          >
            <Upload className="w-4 h-4" />
            {uploading ? 'Uploading...' : 'Upload'}
          </label>
        </div>
      </div>

      {media.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <ImageIcon className="w-16 h-16 mx-auto mb-4 opacity-50" />
          <p>No media files yet. Upload your first image!</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {media.map((item) => (
            <div
              key={item.id}
              className={`relative group bg-slate-800 rounded-lg overflow-hidden border-2 transition-all ${
                selectionMode && selectedMedia?.id === item.id
                  ? 'border-primary ring-2 ring-primary'
                  : 'border-slate-700 hover:border-slate-600'
              } ${selectionMode ? 'cursor-pointer' : ''}`}
              onClick={() => handleSelect(item)}
            >
              <div className="aspect-square relative">
                <img
                  src={item.url}
                  alt={item.originalFilename}
                  className="w-full h-full object-cover"
                />
                {selectionMode && selectedMedia?.id === item.id && (
                  <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                    <Check className="w-8 h-8 text-primary" />
                  </div>
                )}
                <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(item.id);
                    }}
                    className="p-1.5 bg-red-600 hover:bg-red-700 rounded text-white"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="p-2 bg-slate-900/50">
                <p className="text-xs text-slate-300 truncate" title={item.originalFilename}>
                  {item.originalFilename}
                </p>
                <p className="text-xs text-slate-500">
                  {item.width && item.height ? `${item.width}×${item.height}` : ''} • {formatFileSize(item.fileSize)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
