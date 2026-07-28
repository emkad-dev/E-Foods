export function SkeletonBlock({
  width = '100%',
  height = 14,
  radius = 8,
}: {
  width?: string;
  height?: number;
  radius?: number;
}) {
  return (
    <div
      className="skeleton-block"
      style={{ width, height, borderRadius: radius }}
      aria-hidden="true"
    />
  );
}

export function SkeletonRows({ count = 6 }: { count?: number }) {
  return (
    <div className="skeleton-rows" role="status" aria-label="Loading">
      <SkeletonBlock width="100%" height={18} />
      {Array.from({ length: count }, (_, index) => (
        <SkeletonBlock key={index} width="100%" height={40} />
      ))}
    </div>
  );
}
