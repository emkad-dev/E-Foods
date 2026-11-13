// Whether the kitchen alarm is sounding right now, readable outside React.
//
// The foreground notification handler is registered once at module scope
// (usePushNotifications), so it cannot read KitchenAlarmContext. The provider
// publishes its `soundActive` here and the handler reads it when a push lands.
let sounding = false;

export const setKitchenAlarmSounding = (value: boolean) => {
  sounding = value;
};

export const isKitchenAlarmSounding = () => sounding;
