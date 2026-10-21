export function getDehumidifierAutomationDecision({
  humidity,
  targetHumidity,
  isRunning,
  automationActive,
  hysteresisPercent = 1
}) {
  const stopHumidity = targetHumidity - hysteresisPercent;
  const shouldRun = isRunning === true && automationActive === true
    ? humidity > stopHumidity
    : humidity > targetHumidity;

  return { targetHumidity, stopHumidity, shouldRun };
}

export function getMeasurementAlertCycle({
  temperature,
  humidity,
  thresholds,
  previousActiveSignatures = [],
  hysteresisPercent = 1
}) {
  const previous = new Set(previousActiveSignatures);
  const alerts = [];
  const activeAlerts = [];

  if (Number.isFinite(temperature)) {
    if (temperature > thresholds.maxTemperature) {
      const line = `Temperature too high: ${temperature} °C > ${thresholds.maxTemperature} °C`;
      alerts.push(line);
      activeAlerts.push({ signature: "temperature-high", line });
    }

    if (temperature < thresholds.minTemperature) {
      const line = `Temperature too low: ${temperature} °C < ${thresholds.minTemperature} °C`;
      alerts.push(line);
      activeAlerts.push({ signature: "temperature-low", line });
    }
  }

  if (Number.isFinite(humidity)) {
    const stopHumidity = thresholds.maxHumidity - hysteresisPercent;
    if (humidity > thresholds.maxHumidity) {
      const line = `Humidity too high: ${humidity} % > ${thresholds.maxHumidity} %`;
      alerts.push(line);
      activeAlerts.push({ signature: "humidity-high", line });
    } else if (humidity > stopHumidity && previous.has("humidity-high")) {
      activeAlerts.push({
        signature: "humidity-high",
        line: `Humidity automation active until ${stopHumidity} %`
      });
    }

    if (humidity < thresholds.minHumidity) {
      const line = `Humidity too low: ${humidity} % < ${thresholds.minHumidity} %`;
      alerts.push(line);
      activeAlerts.push({ signature: "humidity-low", line });
    }
  }

  const activeSignatures = activeAlerts.map(alert => alert.signature).sort();
  const newlyActiveAlerts = activeAlerts.filter(alert => !previous.has(alert.signature));

  return { alerts, activeAlerts, activeSignatures, newlyActiveAlerts };
}
