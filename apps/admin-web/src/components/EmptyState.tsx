/**
 * The screen a page shows when it has real data and that data is empty.
 *
 * `title` and `body` say what the emptiness MEANS -- a cleared queue is not
 * the same thing as a broken page, and the console was writing both the same
 * way. `note` is the optional third line for a fact rather than an adjective:
 * when a page knows when it last successfully loaded, saying so answers the
 * question the operator actually has ("is this current, or did it just fail
 * quietly?") better than any amount of reassuring copy.
 *
 * `note` is a <div>, not a third <p>, on purpose. The hand-written
 * `.empty-state p` rule sits outside every @layer, so it outranks Tailwind's
 * layered utilities no matter how specific they are -- its `margin: 0` would
 * silently swallow the utility that separates this line from the body.
 */
export default function EmptyState({
  title,
  body,
  note,
}: {
  title: string;
  body: string;
  note?: string;
}) {
  return (
    <div className="empty-state">
      <h4>{title}</h4>
      <p>{body}</p>
      {note ? <div className="mt-2 text-xs">{note}</div> : null}
    </div>
  );
}
