import { ReactNode, useMemo, useState } from 'react';
import { Image, ImageProps } from 'react-native';
import { buildImageCandidates } from '../utils/imageSource';

type RemoteImageProps = Omit<ImageProps, 'source'> & {
  uri?: string | null;
  fallback?: ReactNode;
};

// Drop-in replacement for <Image source={{ uri }} /> that retries the
// untransformed original when a CDN-wrapped URL fails to load. With no uri, or
// once every candidate has failed, it renders the caller's fallback if there is
// one and otherwise an empty Image — same box, same styles, as before.
export default function RemoteImage({ uri, fallback, ...imageProps }: RemoteImageProps) {
  const candidates = useMemo(() => buildImageCandidates(uri), [uri]);
  const [failed, setFailed] = useState<string[]>([]);
  const current = candidates.find((candidate) => !failed.includes(candidate));

  if (!current && fallback !== undefined) {
    return <>{fallback}</>;
  }

  return (
    <Image
      {...imageProps}
      source={{ uri: current }}
      onError={(event) => {
        if (current) {
          // Drop failures for URLs we no longer show so a recycled list row
          // does not accumulate them.
          setFailed((previous) => [
            ...previous.filter((entry) => candidates.includes(entry)),
            current,
          ]);
        }

        imageProps.onError?.(event);
      }}
    />
  );
}
