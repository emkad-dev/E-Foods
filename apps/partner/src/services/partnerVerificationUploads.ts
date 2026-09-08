import { callPartnerBackendRpc } from './backendRpc';

export type PartnerVerificationUploadKind = 'front' | 'back';

export type RequestPartnerVerificationUploadInput = {
  contentType: string;
  extension: string;
  kind: string;
  restaurantId: string;
  uid: string;
};

export type PartnerVerificationUploadResponse = {
  bucket: string;
  contentType: string;
  path: string;
  signedUploadUrl: string;
};

export const requestPartnerVerificationUpload = (input: RequestPartnerVerificationUploadInput) =>
  callPartnerBackendRpc<PartnerVerificationUploadResponse>('requestPartnerVerificationUpload', input);

export const uploadPartnerVerificationDocument = async ({
  fileUri,
  upload,
}: {
  fileUri: string;
  upload: PartnerVerificationUploadResponse;
}) => {
  const response = await fetch(fileUri);

  if (!response.ok) {
    throw new Error(`Unable to read verification document: ${response.status}`);
  }

  const body = await response.arrayBuffer();
  const uploadResponse = await fetch(upload.signedUploadUrl, {
    body,
    headers: {
      'Content-Type': upload.contentType,
    },
    method: 'PUT',
  });

  if (!uploadResponse.ok) {
    throw new Error(`Unable to upload verification document: ${uploadResponse.status}`);
  }

  return upload.path;
};
