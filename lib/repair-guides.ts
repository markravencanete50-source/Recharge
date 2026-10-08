import { REPAIR_TYPES } from './operations-policy';

// Repair types and the basic checks Stays go through with the guest before referring a repair to
// Ready. Safe, guest-facing checks only: anything involving gas, electrics behind panels, water near
// electrics or a smell of burning is escalated, not troubleshot.
export type RepairType = (typeof REPAIR_TYPES)[number];
export const SAFETY_STOP = 'Smell of gas, burning or sparks, water near electrics, or anyone feels unsafe: stop, get the guest safe, and refer as urgent.';
export const REPAIR_GUIDES: Record<RepairType, { label: string; icon: string; checks: string[] }> = {
  heating: { label: 'Heating', icon: 'thermometer', checks: [
    'Thermostat is on, set above room temperature, and its batteries work',
    'Boiler display shows no error code (note any code shown)',
    'Boiler pressure gauge reads between 1 and 1.5 bar',
    'Radiator valves are open; radiators bled if warm at the bottom only',
    'Prepayment meter has credit (if the property has one)',
  ] },
  hot_water: { label: 'Hot water', icon: 'droplet', checks: [
    'Hot water is switched on at the boiler or timer',
    'Boiler display shows no error code (note any code shown)',
    'Tried a different hot tap to see if it is one tap or all',
    'Immersion switch is on (if the property has a cylinder)',
  ] },
  leak: { label: 'Leak', icon: 'cloud-drizzle', checks: [
    'Found where the water is coming from and placed towels or a bowl',
    'Turned off the tap or appliance feeding the leak, or the stopcock if it is spreading',
    'Checked the leak is not near sockets or electrics (if it is: stop and refer as urgent)',
    'Photographed the leak and any damage',
  ] },
  toilet_drain: { label: 'Toilet or drain', icon: 'disc', checks: [
    'Tried a plunger on the blocked toilet, sink or shower',
    'Checked nothing is stuck in the plug hole or trap',
    'Toilet cistern refills after flushing (lid off, float moves)',
    'Asked the guest not to use it until fixed if it is overflowing',
  ] },
  electrics: { label: 'Electrics', icon: 'zap', checks: [
    'Checked whether it is one socket or light, a room, or the whole property',
    'Fuse box: any switch tripped down? Reset once only (if it trips again, stop)',
    'Unplugged appliances on that circuit before resetting',
    'Bulb replaced if it is a single light',
  ] },
  appliance: { label: 'Appliance', icon: 'box', checks: [
    'Appliance is plugged in and switched on at the wall',
    'Tried the socket with another device',
    'Door or lid fully closed (washing machine, dishwasher, microwave)',
    'Noted the make, model and any error code shown',
  ] },
  wifi: { label: 'Wi-Fi', icon: 'wifi', checks: [
    'Router is on and its lights are showing (note which lights)',
    'Router switched off for 30 seconds and back on',
    'Guest is using the correct network name and password',
    'Tried another device to see if it is one device or all',
  ] },
  locks_access: { label: 'Locks or access', icon: 'lock', checks: [
    'Guest is at the right door and using the right key or code',
    'Key safe or smart lock code re-sent and checked',
    'Lock batteries checked (smart locks)',
    'Guest has somewhere safe to wait if they are locked out',
  ] },
  pests: { label: 'Pests', icon: 'alert-circle', checks: [
    'Guest has described or photographed what they found',
    'Food is sealed and bins emptied',
    'Guest offered another room or property if it affects their stay',
  ] },
  damage: { label: 'Damage', icon: 'tool', checks: [
    'Photographed the damage',
    'Made the area safe (broken glass cleared, sharp edges covered)',
    'Noted whether the guest caused it, for the damage claim',
  ] },
  other: { label: 'Other', icon: 'help-circle', checks: [
    'Described exactly what is wrong and where',
    'Photographed the problem if possible',
  ] },
};
export const repairTypeLabel = (type: unknown) => typeof type === 'string' && type in REPAIR_GUIDES ? REPAIR_GUIDES[type as RepairType].label : 'Repair';
// The referral note from the checks ticked and anything else the person adds.
export function troubleshootingNote(type: RepairType, ticked: readonly string[], extra: string) {
  const checks = REPAIR_GUIDES[type].checks.filter(c => ticked.includes(c));
  return [...checks.map(c => '✓ ' + c), ...(extra.trim() ? [extra.trim()] : [])].join('\n');
}
