export default function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty-state">
      <h4>{title}</h4>
      <p>{body}</p>
    </div>
  );
}
