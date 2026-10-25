export type DeviceAction = {
  capability: string;
  labelKey: string;
  permission: string;
  residentPermission?: string;
  category: 'access' | 'power' | 'climate' | 'water' | 'security' | 'maintenance' | 'meter';
  adapterVerified: boolean;
  confirmation: boolean;
  conflictGroup?: string;
  targetState?: string;
  blocksWhenState?: string[];
  hardDenied?: boolean;
};

export type DeviceActionProfile = {
  profile: string;
  deviceType: string;
  adapterVerified: boolean;
  actions: readonly DeviceAction[];
  hardDenied: readonly string[];
};

const barrierActions: DeviceAction[] = [
  {
    capability: 'BARRIER.OPEN', labelKey: 'deviceOpen', permission: 'device.barrier.open.building',
    residentPermission: 'device.barrier.open.own', category: 'access', adapterVerified: true,
    confirmation: false, conflictGroup: 'barrier-motion', targetState: 'OPEN',
    blocksWhenState: ['OPEN', 'OPENING', 'CLOSING'],
  },
  {
    capability: 'BARRIER.CLOSE', labelKey: 'deviceClose', permission: 'device.barrier.close.building',
    category: 'access', adapterVerified: true, confirmation: true, conflictGroup: 'barrier-motion',
    targetState: 'CLOSED', blocksWhenState: ['CLOSED', 'OPENING', 'CLOSING'],
  },
];

export const DEVICE_ACTION_REGISTRY: readonly DeviceActionProfile[] = [
  { profile: 'Vernatun Barrier', deviceType: 'barrier', adapterVerified: true, actions: barrierActions, hardDenied: [] },
  { profile: 'Vernatun Access Door', deviceType: 'access_door', adapterVerified: false, actions: [
    { capability: 'DOOR.OPEN', labelKey: 'deviceOpen', permission: 'device.door.open.building', category: 'access', adapterVerified: false, confirmation: false },
    { capability: 'DOOR.LOCK', labelKey: 'deviceLock', permission: 'device.door.lock.building', category: 'access', adapterVerified: false, confirmation: true },
    { capability: 'DOOR.UNLOCK', labelKey: 'deviceUnlock', permission: 'device.door.unlock.building', category: 'access', adapterVerified: false, confirmation: true },
  ], hardDenied: [] },
  { profile: 'Vernatun Camera', deviceType: 'camera', adapterVerified: false, actions: [
    { capability: 'CAMERA.SNAPSHOT', labelKey: 'deviceSnapshot', permission: 'device.camera.snapshot', category: 'security', adapterVerified: false, confirmation: false },
    { capability: 'CAMERA.LIVE_VIEW', labelKey: 'deviceLiveView', permission: 'device.camera.live_view', category: 'security', adapterVerified: false, confirmation: false },
  ], hardDenied: [] },
  { profile: 'Vernatun Smoke Detector', deviceType: 'smoke_detector', adapterVerified: false, actions: [], hardDenied: ['FIRE.CONTROL'] },
  { profile: 'Vernatun Elevator', deviceType: 'elevator', adapterVerified: false, actions: [], hardDenied: ['ELEVATOR.SAFETY_CONTROL'] },
  { profile: 'Vernatun Water Meter', deviceType: 'water_meter', adapterVerified: false, actions: [
    { capability: 'METER.READ', labelKey: 'deviceRead', permission: 'device.read', category: 'meter', adapterVerified: false, confirmation: false },
    { capability: 'METER.SYNC', labelKey: 'deviceSync', permission: 'device.meter.sync', category: 'meter', adapterVerified: false, confirmation: false },
  ], hardDenied: [] },
  { profile: 'Vernatun Electricity Meter', deviceType: 'electricity_meter', adapterVerified: false, actions: [
    { capability: 'METER.READ', labelKey: 'deviceRead', permission: 'device.read', category: 'meter', adapterVerified: false, confirmation: false },
    { capability: 'METER.SYNC', labelKey: 'deviceSync', permission: 'device.meter.sync', category: 'meter', adapterVerified: false, confirmation: false },
  ], hardDenied: [] },
  { profile: 'Vernatun HVAC', deviceType: 'hvac', adapterVerified: false, actions: [
    { capability: 'HVAC.ON', labelKey: 'deviceOn', permission: 'device.hvac.control', category: 'climate', adapterVerified: false, confirmation: false },
    { capability: 'HVAC.OFF', labelKey: 'deviceOff', permission: 'device.hvac.control', category: 'climate', adapterVerified: false, confirmation: true },
    { capability: 'HVAC.SETPOINT', labelKey: 'deviceSetpoint', permission: 'device.hvac.control', category: 'climate', adapterVerified: false, confirmation: true },
    { capability: 'HVAC.MODE_SET', labelKey: 'deviceMode', permission: 'device.hvac.control', category: 'climate', adapterVerified: false, confirmation: true },
  ], hardDenied: [] },
  { profile: 'Vernatun Pump', deviceType: 'pump', adapterVerified: false, actions: [
    { capability: 'PUMP.START', labelKey: 'deviceStart', permission: 'device.pump.control', category: 'water', adapterVerified: false, confirmation: true },
    { capability: 'PUMP.STOP', labelKey: 'deviceStop', permission: 'device.pump.control', category: 'water', adapterVerified: false, confirmation: true },
  ], hardDenied: [] },
  { profile: 'Vernatun Water Valve', deviceType: 'water_valve', adapterVerified: false, actions: [
    { capability: 'VALVE.OPEN', labelKey: 'deviceOpen', permission: 'device.valve.control', category: 'water', adapterVerified: false, confirmation: true },
    { capability: 'VALVE.CLOSE', labelKey: 'deviceClose', permission: 'device.valve.control', category: 'water', adapterVerified: false, confirmation: true },
  ], hardDenied: [] },
];

export function getDeviceActionProfile(profile: unknown) {
  return DEVICE_ACTION_REGISTRY.find(item => item.profile === profile);
}

export function getDeviceActionDefinition(capability: string) {
  return DEVICE_ACTION_REGISTRY.flatMap(profile => profile.actions)
    .find(action => action.capability === capability);
}

export function reportedCapabilitiesForProfile(profile: unknown, edgeReported?: readonly string[]) {
  const definition = getDeviceActionProfile(profile);
  if (!definition?.adapterVerified) return [];
  const verified = definition.actions.filter(action => action.adapterVerified).map(action => action.capability);
  return edgeReported ? verified.filter(capability => edgeReported.includes(capability)) : verified;
}

export function defaultEnabledCapabilitiesForProfile(profile: unknown) {
  return reportedCapabilitiesForProfile(profile);
}
