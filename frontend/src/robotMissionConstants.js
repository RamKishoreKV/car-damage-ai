export const MISSION_STATES = {
  IDLE: "IDLE",
  MOVING_TO_VEHICLE: "MOVING_TO_VEHICLE",
  CAPTURING_FRONT: "CAPTURING_FRONT",
  CAPTURING_LEFT: "CAPTURING_LEFT",
  CAPTURING_RIGHT: "CAPTURING_RIGHT",
  CAPTURING_REAR: "CAPTURING_REAR",
  RUNNING_AI_INSPECTION: "RUNNING_AI_INSPECTION",
  SAVING_TO_FLEET_DASHBOARD: "SAVING_TO_FLEET_DASHBOARD",
  COMPLETE: "COMPLETE",
  CANCELLED: "CANCELLED",
  ERROR: "ERROR",
};

export const STATE_ORDER = [
  MISSION_STATES.IDLE,
  MISSION_STATES.MOVING_TO_VEHICLE,
  MISSION_STATES.CAPTURING_FRONT,
  MISSION_STATES.CAPTURING_LEFT,
  MISSION_STATES.CAPTURING_RIGHT,
  MISSION_STATES.CAPTURING_REAR,
  MISSION_STATES.RUNNING_AI_INSPECTION,
  MISSION_STATES.SAVING_TO_FLEET_DASHBOARD,
  MISSION_STATES.COMPLETE,
];

export const TIMELINE_STEPS = [
  {
    id: "init",
    label: "Robot initialized",
    activeAt: MISSION_STATES.MOVING_TO_VEHICLE,
    completeFrom: MISSION_STATES.CAPTURING_FRONT,
  },
  {
    id: "move",
    label: "Moving to vehicle",
    activeAt: MISSION_STATES.MOVING_TO_VEHICLE,
    completeFrom: MISSION_STATES.CAPTURING_FRONT,
  },
  {
    id: "front",
    label: "Front camera captured",
    activeAt: MISSION_STATES.CAPTURING_FRONT,
    completeFrom: MISSION_STATES.CAPTURING_LEFT,
  },
  {
    id: "left",
    label: "Left camera captured",
    activeAt: MISSION_STATES.CAPTURING_LEFT,
    completeFrom: MISSION_STATES.CAPTURING_RIGHT,
  },
  {
    id: "right",
    label: "Right camera captured",
    activeAt: MISSION_STATES.CAPTURING_RIGHT,
    completeFrom: MISSION_STATES.CAPTURING_REAR,
  },
  {
    id: "rear",
    label: "Rear camera captured",
    activeAt: MISSION_STATES.CAPTURING_REAR,
    completeFrom: MISSION_STATES.RUNNING_AI_INSPECTION,
  },
  {
    id: "ai",
    label: "AI inspection complete",
    activeAt: MISSION_STATES.RUNNING_AI_INSPECTION,
    completeFrom: MISSION_STATES.SAVING_TO_FLEET_DASHBOARD,
  },
  {
    id: "save",
    label: "Report saved to fleet dashboard",
    activeAt: MISSION_STATES.SAVING_TO_FLEET_DASHBOARD,
    completeFrom: MISSION_STATES.COMPLETE,
  },
];

export const CAPTURE_SEQUENCE = ["front", "left_side", "right_side", "rear"];

export const CAMERA_SLOTS = [
  { key: "front", label: "Front Camera", view: "front" },
  { key: "left_side", label: "Left Camera", view: "left_side" },
  { key: "right_side", label: "Right Camera", view: "right_side" },
  { key: "rear", label: "Rear Camera", view: "rear" },
];

export const ACTIVE_CAPTURE_BY_STATE = {
  [MISSION_STATES.CAPTURING_FRONT]: "front",
  [MISSION_STATES.CAPTURING_LEFT]: "left_side",
  [MISSION_STATES.CAPTURING_RIGHT]: "right_side",
  [MISSION_STATES.CAPTURING_REAR]: "rear",
};

export function stateIndex(state) {
  return STATE_ORDER.indexOf(state);
}

export function isStepComplete(step, currentState) {
  if (currentState === MISSION_STATES.COMPLETE) return true;
  if (currentState === MISSION_STATES.CANCELLED || currentState === MISSION_STATES.ERROR) {
    return false;
  }
  if (!step.completeFrom) return false;
  return stateIndex(currentState) >= stateIndex(step.completeFrom);
}

export function isStepActive(step, currentState) {
  if (!step.activeAt) return false;
  return currentState === step.activeAt;
}

export function missionProgressPercent(currentState) {
  if (currentState === MISSION_STATES.COMPLETE) return 100;
  if (currentState === MISSION_STATES.CANCELLED || currentState === MISSION_STATES.ERROR) {
    return 0;
  }
  const idx = stateIndex(currentState);
  if (idx <= 0) return 0;
  return Math.round((idx / (STATE_ORDER.length - 1)) * 100);
}

export function randomDelayMs() {
  return 1000 + Math.floor(Math.random() * 1000);
}
