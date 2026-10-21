import test from "node:test";
import assert from "node:assert/strict";
import {
  getDehumidifierAutomationDecision,
  getMeasurementAlertCycle
} from "./automation-logic.mjs";

const thresholds = {
  minTemperature: 0,
  maxTemperature: 40,
  minHumidity: 0,
  maxHumidity: 60
};

test("starts automation only above the configured maximum", () => {
  assert.equal(getDehumidifierAutomationDecision({
    humidity: 60.1,
    targetHumidity: 60,
    isRunning: false,
    automationActive: false
  }).shouldRun, true);

  assert.equal(getDehumidifierAutomationDecision({
    humidity: 60,
    targetHumidity: 60,
    isRunning: false,
    automationActive: false
  }).shouldRun, false);
});

test("keeps an automated run active until one percentage point below maximum", () => {
  assert.equal(getDehumidifierAutomationDecision({
    humidity: 59.1,
    targetHumidity: 60,
    isRunning: true,
    automationActive: true
  }).shouldRun, true);

  assert.equal(getDehumidifierAutomationDecision({
    humidity: 59,
    targetHumidity: 60,
    isRunning: true,
    automationActive: true
  }).shouldRun, false);
});

test("sends high humidity once and keeps the cycle active in the hysteresis band", () => {
  const first = getMeasurementAlertCycle({
    temperature: 20,
    humidity: 60.2,
    thresholds
  });
  assert.deepEqual(first.activeSignatures, ["humidity-high"]);
  assert.equal(first.newlyActiveAlerts.length, 1);

  const changedValue = getMeasurementAlertCycle({
    temperature: 20,
    humidity: 61,
    thresholds,
    previousActiveSignatures: first.activeSignatures
  });
  assert.equal(changedValue.newlyActiveAlerts.length, 0);

  const hysteresisBand = getMeasurementAlertCycle({
    temperature: 20,
    humidity: 59.5,
    thresholds,
    previousActiveSignatures: first.activeSignatures
  });
  assert.deepEqual(hysteresisBand.activeSignatures, ["humidity-high"]);
  assert.equal(hysteresisBand.newlyActiveAlerts.length, 0);
});

test("re-arms high humidity only after reaching the stop threshold", () => {
  const reset = getMeasurementAlertCycle({
    temperature: 20,
    humidity: 59,
    thresholds,
    previousActiveSignatures: ["humidity-high"]
  });
  assert.deepEqual(reset.activeSignatures, []);

  const nextCycle = getMeasurementAlertCycle({
    temperature: 20,
    humidity: 60.2,
    thresholds,
    previousActiveSignatures: reset.activeSignatures
  });
  assert.equal(nextCycle.newlyActiveAlerts.length, 1);
});
