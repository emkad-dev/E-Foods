/**
 * A button label that rolls up to a celebratory line on hover and on keyboard
 * focus -- for the handful of actions that are genuine wins for the platform
 * (a new partner, a new rider, a restaurant going live).
 *
 * Three rules keep the flourish from costing clarity:
 *
 * 1. The win line must describe the SAME outcome as the plain label. "Publish"
 *    may become "Go live"; it may never become something that implies a
 *    different action. Clicking is the moment of commitment, and the words
 *    under the cursor at that moment must not surprise anyone.
 *
 * 2. The plain label is the button's only accessible name. The win line is
 *    aria-hidden, so a screen reader announces "Approve, button" exactly as it
 *    did before, and the confirmation dialog and toast ("Approved") still match
 *    the name the operator heard.
 *
 * 3. Both lines occupy the same grid cell, so the button is always as wide as
 *    the longer of the two. Nothing reflows on hover -- which matters here
 *    because every one of these buttons sits beside a destructive one, and a
 *    control that shifts its neighbour on hover invites a mis-click.
 *
 * Where it is used (each an owner decision): Approve a partner and Approve a
 * rider ("Welcome aboard"), Publish a restaurant ("Go live"), Send promo
 * ("Reach customers"), Send now on a broadcast ("Get the word out") and Mark
 * resolved on an alert ("Case closed"). The broadcast send goes to every user
 * and cannot be undone, so its confirm dialog keeps the plain "Send now".
 *
 * Never use it on a destructive action -- Reject, Delete, Disable -- or on
 * Enable, which restores a suspended account. A cheerful hover line on those
 * would be tone-deaf at best.
 */
export default function WinLabel({ idle, win }: { idle: string; win: string }) {
  return (
    <span className="win-label">
      <span className="win-label-idle">{idle}</span>
      <span className="win-label-win" aria-hidden="true">
        {win}
      </span>
    </span>
  );
}
