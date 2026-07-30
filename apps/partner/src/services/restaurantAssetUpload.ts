import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import {
  MAX_UPLOAD_BYTES,
  QUALITY_STEPS,
  formatKb,
  isWithinBudget,
  resolveTargetDimensions,
} from './imageBudget';
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

const readBytes = async (uri: string) => {
  const response = await fetch(uri);
  return response.arrayBuffer();
};

type PreparedAsset = {
  body: ArrayBuffer;
  mimeType: string;
};

/**
 * Shrinks an image to fit MAX_UPLOAD_BYTES before it reaches Storage.
 *
 * expo-image-picker's `quality` only re-encodes and `allowsEditing` only crops,
 * so nothing upstream bounds resolution — a phone photo could otherwise land in
 * Storage at several megabytes while delivery is pinned to width=800 by the
 * Cloudflare transformation. This caps the longest edge, then walks the quality
 * ladder until the encoded result fits.
 *
 * PNG keeps its format so logo transparency survives; `compress` is a no-op for
 * lossless PNG, so it gets the resize only.
 */
const prepareAssetForUpload = async (uri: string, mimeType: string): Promise<PreparedAsset> => {
  const isPng = mimeType === 'image/png';
  const format = isPng ? SaveFormat.PNG : SaveFormat.JPEG;

  const rendered = await ImageManipulator.manipulate(uri).renderAsync();
  const target = resolveTargetDimensions({ width: rendered.width, height: rendered.height });
  const needsResize = target.width !== rendered.width || target.height !== rendered.height;

  const image = needsResize
    ? await ImageManipulator.manipulate(uri).resize(target).renderAsync()
    : rendered;

  // PNG ignores `compress`, so trying the ladder would just re-encode the same
  // bytes repeatedly.
  const qualities = isPng ? [QUALITY_STEPS[0]] : QUALITY_STEPS;

  let smallest: PreparedAsset | null = null;

  for (const compress of qualities) {
    const saved = await image.saveAsync({ compress, format });
    const body = await readBytes(saved.uri);

    if (isWithinBudget(body.byteLength)) {
      return { body, mimeType: isPng ? 'image/png' : 'image/jpeg' };
    }

    if (!smallest || body.byteLength < smallest.body.byteLength) {
      smallest = { body, mimeType: isPng ? 'image/png' : 'image/jpeg' };
    }
  }

  // Every step was still over budget. Upload the smallest we managed rather than
  // blocking the partner from setting an image at all.
  if (smallest) {
    console.warn(
      `Restaurant asset stayed above the ${formatKb(MAX_UPLOAD_BYTES)} budget at ${formatKb(
        smallest.body.byteLength
      )}; uploading the smallest encoding.`
    );

    return smallest;
  }

  return { body: await readBytes(uri), mimeType };
};

export const uploadRestaurantAsset = async ({ kind, ownerId, uri }: UploadRestaurantAssetInput) => {
  const sourceMimeType = getAssetMimeType(uri);

  let prepared: PreparedAsset;

  try {
    prepared = await prepareAssetForUpload(uri, sourceMimeType);
  } catch (error) {
    // Fail open: a manipulation failure must not stop a partner setting an
    // image. Storing an oversized asset is a cost problem; a broken upload flow
    // is a product one.
    console.warn('Image compression failed; uploading the original.', error);
    prepared = { body: await readBytes(uri), mimeType: sourceMimeType };
  }

  const extension = getAssetExtension(prepared.mimeType);
  const filePath = `${kind}/${ownerId}/${Date.now()}.${extension}`;

  const { error } = await supabase.storage
    .from(RESTAURANT_ASSETS_BUCKET)
    .upload(filePath, prepared.body, {
      contentType: prepared.mimeType,
      upsert: true,
    });

  if (error) {
    throw new Error(error.message);
  }

  const { data } = supabase.storage.from(RESTAURANT_ASSETS_BUCKET).getPublicUrl(filePath);
  return data.publicUrl;
};
