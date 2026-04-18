export const dispatchMetrics = [
  { label: 'Active trips', value: '18', delta: '+4 vs 30 mins ago' },
  { label: 'Ready pickups', value: '6', delta: '2 need assignment now' },
  { label: 'Riders online', value: '11', delta: '3 idle in Lekki' },
  { label: 'Exceptions', value: '3', delta: '1 customer delay complaint' },
] as const;

export const liveDeliveries = [
  {
    id: '#4029',
    restaurant: 'Mama B Kitchen',
    destination: 'Admiralty Way',
    rider: 'Sadiq',
    eta: '12 mins',
    distance: '3.1 km',
    note: 'Customer asked for a gate call on arrival.',
    status: 'On route',
    priority: 'Normal',
    progressWidth: '72%',
    badgeBackground: '#dbeafe',
    badgeColor: '#1d4ed8',
  },
  {
    id: '#4034',
    restaurant: 'Urban Grill Hub',
    destination: 'Oniru Estate',
    rider: 'Favour',
    eta: '18 mins',
    distance: '5.2 km',
    note: 'Restaurant marked order ready later than target SLA.',
    status: 'Late pickup',
    priority: 'High',
    progressWidth: '44%',
    badgeBackground: '#fee2e2',
    badgeColor: '#b91c1c',
  },
  {
    id: '#4041',
    restaurant: 'Nori Bowl',
    destination: 'Yaba Tech Towers',
    rider: 'Kelvin',
    eta: '7 mins',
    distance: '1.8 km',
    note: 'Fast lane route active after dispatcher rebalance.',
    status: 'Final stretch',
    priority: 'Normal',
    progressWidth: '88%',
    badgeBackground: '#dcfce7',
    badgeColor: '#166534',
  },
] as const;

export const dispatchAlerts = [
  {
    title: '2 riders drifting out of Lekki phase 1',
    copy: 'Rebalance before the next pickup spike or the east corridor will turn red.',
  },
  {
    title: 'Urban Grill Hub breached pickup prep target',
    copy: 'Keep an eye on repeated prep delays so partner support can step in early.',
  },
] as const;

export const dispatchZones = [
  {
    name: 'Lekki East',
    activeOrders: 7,
    idleRiders: 1,
    load: 'Heavy',
    tagBackground: '#fee2e2',
    tagColor: '#b91c1c',
  },
  {
    name: 'Victoria Island',
    activeOrders: 6,
    idleRiders: 3,
    load: 'Balanced',
    tagBackground: '#dcfce7',
    tagColor: '#166534',
  },
  {
    name: 'Yaba Central',
    activeOrders: 5,
    idleRiders: 2,
    load: 'Watch',
    tagBackground: '#fff7d6',
    tagColor: '#9a6700',
  },
] as const;

export const riderFleet = [
  {
    name: 'Sadiq A.',
    zone: 'Lekki East',
    status: 'Delivering',
    completedTrips: '9',
    acceptanceRate: '94%',
    activeLoad: '2 orders',
    badgeBackground: '#dbeafe',
    badgeColor: '#1d4ed8',
  },
  {
    name: 'Favour K.',
    zone: 'Victoria Island',
    status: 'Pickup delayed',
    completedTrips: '7',
    acceptanceRate: '91%',
    activeLoad: '1 order',
    badgeBackground: '#fee2e2',
    badgeColor: '#b91c1c',
  },
  {
    name: 'Kelvin O.',
    zone: 'Yaba Central',
    status: 'Available soon',
    completedTrips: '11',
    acceptanceRate: '97%',
    activeLoad: 'Returning',
    badgeBackground: '#dcfce7',
    badgeColor: '#166534',
  },
] as const;
