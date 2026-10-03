import type { MaintenanceCategory } from "@/lib/maintenance-types";

export type TroubleshootingItem = {
  id: string;
  label: string;
};

export const MAINTENANCE_CHECKLISTS: Record<
  MaintenanceCategory,
  TroubleshootingItem[]
> = {
  Plumbing: [
    { id: "plumbing-location", label: "Confirm the exact fixture and whether the issue is a leak, blockage or loss of water." },
    { id: "plumbing-isolate", label: "Ask the guest to stop using the affected fixture and isolate the local water supply only if it is safe." },
    { id: "plumbing-visible", label: "Check visible taps, traps and connections for an obvious cause without dismantling anything." },
    { id: "plumbing-impact", label: "Confirm whether water is affecting electrics, another room or a neighbouring property." },
    { id: "plumbing-evidence", label: "Collect clear photos or video showing the issue and surrounding area." },
  ],
  "Heating & hot water": [
    { id: "heating-context", label: "Check the property record and previous maintenance history for known boiler notes, repeat faults and property-specific instructions." },
    { id: "heating-scope", label: "Confirm whether heating, hot water or the shower is affected, and identify whether the system is gas, electric, prepay or an independent electric shower." },
    { id: "heating-evidence", label: "Ask what has already been tried and collect photos of the thermostat, boiler or heating system, error display and gas or electric meter." },
    { id: "heating-controls", label: "Check only basic user controls: power, thermostat above room temperature, active timer or schedule, open radiator valves and available prepay credit." },
    { id: "heating-reset", label: "If there is no gas smell, leak or other danger sign, try one safe off-and-on reset only. Never ask the guest to open or tamper with the boiler." },
    { id: "heating-code", label: "If an error code remains or the safe checks fail, record it for the local approved heating engineer and stop remote troubleshooting." },
  ],
  Electrical: [
    { id: "electrical-scope", label: "Is this a whole-property power loss, partial loss, one appliance, an electric shower, a prepay issue, or suspected unsafe wiring? Record exactly what is and is not working." },
    { id: "electrical-evidence", label: "Collect safe photos or video of the fault, consumer unit and meter where relevant. Record when it started and whether anything tripped, flashed or made a noise." },
    { id: "electrical-supply", label: "For whole-property loss, check communal or neighbouring power, the meter display, prepay credit and any known local outage." },
    { id: "electrical-switches", label: "If there is no visible damage, check the ordinary plug, wall switch, pull cord, local isolator or fused spur. Never open the unit or remove a cover." },
    { id: "electrical-breaker", label: "If a breaker has tripped and there are no danger signs, unplug the likely appliance and try one reset only. If it trips again, stop and escalate." },
    { id: "electrical-appliance", label: "For one appliance only, test the appliance in another safe socket or the original socket with another low-risk item, where appropriate." },
  ],
  "Access & locks": [
    { id: "access-scope", label: "Confirm which door or lock is affected and whether the guest is inside, outside or unable to secure it." },
    { id: "access-key", label: "Try the spare key or keybox key and confirm the correct key is being used." },
    { id: "access-handle", label: "Ask the guest to gently relieve pressure on the door while operating the handle and lock." },
    { id: "access-safety", label: "Confirm the guest still has a safe route to enter and leave the property." },
    { id: "access-evidence", label: "Collect a photo or short video of the lock, handle and door alignment." },
  ],
  Appliances: [
    { id: "appliance-details", label: "Record the appliance type, make, model and any error code." },
    { id: "appliance-power", label: "Confirm the plug, socket, fused switch and normal controls are switched on." },
    { id: "appliance-restart", label: "Power the appliance off once for 60 seconds and restart it if safe." },
    { id: "appliance-basic", label: "Check the door, filter, water supply or selected programme where relevant." },
    { id: "appliance-evidence", label: "Collect photos or video showing the controls, error and fault behaviour." },
  ],
  "Furniture & fittings": [
    { id: "furniture-stop", label: "Ask the guest to stop using the damaged item and make the area safe." },
    { id: "furniture-location", label: "Confirm the exact room and item affected." },
    { id: "furniture-visible", label: "Check visually for loose, missing or broken fixings without attempting a repair." },
    { id: "furniture-alternative", label: "Confirm the guest impact and whether a safe temporary alternative is available." },
    { id: "furniture-evidence", label: "Collect wide and close-up photos of the item and damage." },
  ],
  Decorating: [
    { id: "decorating-location", label: "Confirm the room, surface and approximate size of the affected area." },
    { id: "decorating-moisture", label: "Check whether there is active water, dampness or staining that may indicate a leak." },
    { id: "decorating-cause", label: "Record whether the issue is new damage, wear and tear or a recurring defect." },
    { id: "decorating-safety", label: "Keep guests away from loose plaster, broken finishes or any unsafe area." },
    { id: "decorating-evidence", label: "Collect a clear room photo and close-ups of the affected surface." },
  ],
  "Pest control": [
    { id: "pest-identify", label: "Identify the pest, where it was seen and the time of the sighting." },
    { id: "pest-evidence", label: "Collect a photo or video where possible without handling the pest." },
    { id: "pest-source", label: "Check for exposed food, waste, standing water or an obvious entry point." },
    { id: "pest-contain", label: "Ask the guest to seal food and remove accessible waste." },
    { id: "pest-impact", label: "Confirm the number of sightings, affected rooms and impact on the guest." },
  ],
  Safety: [
    { id: "safety-isolate", label: "Stop use of the affected area or equipment and make the immediate area safe." },
    { id: "safety-emergency", label: "Confirm whether anyone is injured or emergency services are required." },
    { id: "safety-hazard", label: "Record the exact hazard without touching exposed wiring, gas equipment or unstable items." },
    { id: "safety-occupants", label: "Confirm who is at the property and whether they have a safe place to wait." },
    { id: "safety-evidence", label: "Collect photos from a safe distance and alert management immediately." },
  ],
  "General repair": [
    { id: "general-location", label: "Confirm exactly what is affected and where it is located." },
    { id: "general-controls", label: "Check the normal controls, switches or simple user settings." },
    { id: "general-reset", label: "Try one safe basic reset or restart where appropriate." },
    { id: "general-impact", label: "Record the guest impact, urgency and access arrangements." },
    { id: "general-evidence", label: "Collect clear photos or video showing the issue." },
  ],
};

export function checklistForCategory(category: MaintenanceCategory) {
  return MAINTENANCE_CHECKLISTS[category];
}
