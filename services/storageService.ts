import { supabase } from './supabaseClient';

const BUCKET = 'resume-photos';
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB
const MAX_DIMENSION = 800; // 最大边长
const JPEG_QUALITY = 0.85;

/**
 * 压缩图片：限制最大尺寸并转为 JPEG
 */
const compressImage = (file: File): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      let { width, height } = img;

      // 按比例缩放
      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        if (width > height) {
          height = Math.round(height * (MAX_DIMENSION / width));
          width = MAX_DIMENSION;
        } else {
          width = Math.round(width * (MAX_DIMENSION / height));
          height = MAX_DIMENSION;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('无法创建 canvas context'));
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('图片压缩失败'));
        },
        'image/jpeg',
        JPEG_QUALITY
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片加载失败'));
    };

    img.src = url;
  });
};

/**
 * 上传照片到 Supabase Storage
 * 路径格式: {userId}/photo_{timestamp}.jpg
 */
export const uploadResumePhoto = async (
  file: File,
  userId: string
): Promise<{ url: string; error: string | null }> => {
  // 校验文件类型
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    return { url: '', error: '仅支持 JPG、PNG、WebP 格式' };
  }

  // 校验文件大小
  if (file.size > MAX_FILE_SIZE) {
    return { url: '', error: '文件大小不能超过 2MB' };
  }

  try {
    // 压缩图片
    const compressed = await compressImage(file);

    // 使用固定文件名，upsert 覆盖旧文件，URL 永远不变
    // 这样所有简历共享同一个照片 URL，不会因重新上传导致旧简历照片失效
    const fileName = `${userId}/photo.jpg`;

    // 上传照片（覆盖已有文件）
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(fileName, compressed, {
        contentType: 'image/jpeg',
        upsert: true,
      });

    if (uploadError) {
      return { url: '', error: '上传失败：' + uploadError.message };
    }

    // 获取公开 URL（加时间戳避免浏览器缓存旧图片）
    const { data: urlData } = supabase.storage
      .from(BUCKET)
      .getPublicUrl(fileName);

    return { url: urlData.publicUrl, error: null };
  } catch (err: any) {
    return { url: '', error: err.message || '上传失败' };
  }
};

/**
 * 删除用户的简历照片
 */
export const deleteResumePhoto = async (userId: string): Promise<void> => {
  await supabase.storage.from(BUCKET).remove([`${userId}/photo.jpg`]);
  // 兼容清理旧格式文件（photo_xxx.jpg）
  const { data: files } = await supabase.storage.from(BUCKET).list(userId);
  if (files && files.length > 0) {
    const toDelete = files.map((f) => `${userId}/${f.name}`);
    await supabase.storage.from(BUCKET).remove(toDelete);
  }
};

/**
 * 校验图片 URL 是否可访问
 */
export const validateImageUrl = (url: string): Promise<boolean> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    // 设置超时
    setTimeout(() => resolve(false), 5000);
    img.src = url;
  });
};
