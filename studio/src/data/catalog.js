// IG Studio scenario catalog — v2
// 4 scenarios: 3D print farm (engineering reference) + 3 business scenarios.
// Each scenario module exports a self-contained entry; the catalog aggregates.

import { PRINT3D_SCENARIO } from './print3d-scenario.js';
import { BUSINESS_SCENARIOS } from './business-scenarios.js';

export const SCENARIO_CATALOG = [PRINT3D_SCENARIO, ...BUSINESS_SCENARIOS];

export function getScenario(id) {
  return SCENARIO_CATALOG.find((s) => s.id === id) || null;
}

export function getInstance(scenarioId, instanceId) {
  const sc = getScenario(scenarioId);
  if (!sc) return null;
  return sc.instances.find((i) => i.id === instanceId) || null;
}
