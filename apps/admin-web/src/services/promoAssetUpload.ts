import { supabase } from '../lib/supabase';

const PROMO_ASSETS_BUCKET = 'promo-assets';

const extensionFor = (type: string): string => {
  if (type === 'image/png') return 'png';
  if (type === 'image/webp') return 'webp';
  return 'jpg';
};

export const uploadPromoAsset = async (file: File): Promise<string> => {
  const extension = extensionFor(file.type);
  const filePath = `promos/${Date.now()}.${extension}`;

  const { error } = await supabase.storage
    .from(PROMO_ASSETS_BUCKET)
    .upload(filePath, file, { contentType: file.type || 'image/jpeg', upsert: true });

  if (error) {
    console.warn('Promo asset upload failed:', error.message);
    throw new Error('Unable to upload this image right now. Please try again.');
  }

  const { data } = supabase.storage.from(PROMO_ASSETS_BUCKET).getPublicUrl(filePath);
  return data.publicUrl;
};
