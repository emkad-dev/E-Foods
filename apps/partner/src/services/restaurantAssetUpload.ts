import { supabase } from './supabase/config';

const RESTAURANT_ASSETS_BUCKET = 'restaurant-assets';

type RestaurantAssetKind = 'covers' | 'logos';

type UploadRestaurantAssetInput = {
  kind: RestaurantAssetKind;
  ownerId: string;
  uri: string;
};

const getAssetMimeType = (uri: string) => {
  const normalizedUri = uri.toLowerCase();

  if (normalizedUri.includes('.png')) {
    return 'image/png';
  }

  if (normalizedUri.includes('.webp')) {
    return 'image/webp';
  }

  return 'image/jpeg';
};

const getAssetExtension = (mimeType: string) => {
  if (mimeType === 'image/png') {
    return 'png';
  }

  if (mimeType === 'image/webp') {
    return 'webp';
  }

  return 'jpg';
};

export const uploadRestaurantAsset = async ({ kind, ownerId, uri }: UploadRestaurantAssetInput) => {
  const mimeType = getAssetMimeType(uri);
  const extension = getAssetExtension(mimeType);
  const response = await fetch(uri);
  const body = await response.arrayBuffer();
  const filePath = `${kind}/${ownerId}/${Date.now()}.${extension}`;

  const { error } = await supabase.storage
    .from(RESTAURANT_ASSETS_BUCKET)
    .upload(filePath, body, {
      contentType: mimeType,
      upsert: true,
    });

  if (error) {
    throw new Error(error.message);
  }

  const { data } = supabase.storage.from(RESTAURANT_ASSETS_BUCKET).getPublicUrl(filePath);
  return data.publicUrl;
};
