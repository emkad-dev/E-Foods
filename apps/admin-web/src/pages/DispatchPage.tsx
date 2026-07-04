import EmptyState from '../components/EmptyState';

// The platform rider network is shelved for the MVP — restaurants self-provision
// their own delivery. This page is a placeholder so the shelved feature has a
// clear home in the console when it comes back online.
export default function DispatchPage() {
  return (
    <div className="page">
      <div className="card">
        <div className="card-title-row">
          <h3 className="card-title">Rider network</h3>
        </div>
        <EmptyState
          title="Dispatch is coming soon"
          body="Platform-managed rider dispatch isn't live yet. Restaurants currently self-provision delivery from their own profile and complete orders directly. This is where the FEASTY rider network will appear once it launches."
        />
      </div>
    </div>
  );
}
