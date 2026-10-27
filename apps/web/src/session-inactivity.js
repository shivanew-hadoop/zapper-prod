// Presentation-only helpers. The API controls inactivity and PDF finalization.
export function inactivityAlertState(payload, now = Date.now()) {
  if (!payload?.active || !payload?.monitored || !payload.showWarning) return { visible: false, secondsLeft: 0 };
  return { visible: true, secondsLeft: Math.max(0, Math.ceil((Number(payload.endAt || 0) - now) / 1000)) };
}
