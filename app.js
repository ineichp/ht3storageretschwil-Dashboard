const API_BASE_URL = "https://onbcgvleu4.execute-api.eu-central-1.amazonaws.com";
const DEVICE_ID = "shellyhtg3-e4b3232fa628";
const POWER_IOT_DEVICE_ID = "plugsstorageretschwil";
const DEHUMIDIFIER_DEVICE_ID = "dehumidifier";
const DEHUMIDIFIER_ACTIVE_WATTS = 10;

let LIMITS = {
  maxTemperature: 20,
  minTemperature: 5,
  maxHumidity: 50,
  minHumidity: 0,
  cooldownHours: 24
};

let tempChart;
let humidityChart;
let videos = [];
let events = [];
let eventPage = 1;
let eventDayOpenState = {};
let latestFloodState = {};
let latestHt3Update = null;
let latestPowerIotState = {};
let latestDehumidifierState = {};
let latestAuditCosts = {};
const EVENTS_PER_PAGE = 10;

function isTemperatureAlert(value) {
  const n = Number(value);
  return Number.isFinite(n) && (n > LIMITS.maxTemperature || n < LIMITS.minTemperature);
}

function isHumidityAlert(value) {
  const n = Number(value);
  return Number.isFinite(n) && (n > LIMITS.maxHumidity || n < LIMITS.minHumidity);
}

function thresholdClass(isAlert) {
  return isAlert ? "threshold-alert" : "threshold-ok";
}

function renderFloodState(state = {}) {
  latestFloodState = state;
  renderBatteryStatus("flood", pickBatteryPercent(state));
  renderCableStatus("flood", state.cableUnplugged);
  renderDeviceStatusMeta();

  const isFlood = state.flood === true;
  const status = document.getElementById("floorFloodStatus");
  const icon = document.getElementById("floorFloodIcon");
  const meta = document.getElementById("floorFloodMeta");

  status.textContent = isFlood ? "Flood" : "Dry";
  status.className = thresholdClass(isFlood);
  if (icon) {
    icon.className = `floor-flood-icon ${isFlood ? "flood" : "dry"}`;
    icon.title = isFlood ? "Floor Flood detected" : "Floor Flood dry";
    icon.setAttribute("aria-label", icon.title);
  }

  if (state.updatedAt) {
    meta.textContent = `Last update: ${formatDateTime(state.updatedAt)}`;
    return;
  }

  meta.textContent = "Last update: —";
}

async function loadFloodState() {
  try {
    const response = await fetch(`${API_BASE_URL}/flood`);
    if (!response.ok) throw new Error(`Flood API returned HTTP ${response.status}`);

    renderFloodState(await response.json());
  } catch (error) {
    console.error(error);
    document.getElementById("floorFloodStatus").textContent = "Dry";
    document.getElementById("floorFloodStatus").className = thresholdClass(false);
    const icon = document.getElementById("floorFloodIcon");
    if (icon) {
      icon.className = "floor-flood-icon dry";
      icon.title = "Floor Flood dry";
      icon.setAttribute("aria-label", icon.title);
    }
    document.getElementById("floorFloodMeta").textContent = "Flood API error";
    latestFloodState = {};
    renderBatteryStatus("flood", null);
    renderCableStatus("flood", null);
    renderDeviceStatusMeta();
  }
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function toBatteryPercent(value) {
  if (value === null || value === undefined || value === "") return null;

  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function pickBatteryPercent(source = {}) {
  const candidates = [
    source.batteryPercent,
    source.battery,
    source.battery_pct,
    source.batteryPct,
    source.batteryLevel,
    source.bat,
    source.devicepower?.battery?.percent,
    source["devicepower:0"]?.battery?.percent
  ];

  for (const candidate of candidates) {
    const percent = toBatteryPercent(candidate);
    if (percent !== null) return percent;
  }

  return null;
}

function toPowerPresent(value) {
  if (value === true || value === false) return value;
  if (value === 1 || value === "1") return true;
  if (value === 0 || value === "0") return false;

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "yes", "on", "present", "external", "power"].includes(normalized)) return true;
    if (["false", "no", "off", "absent", "battery"].includes(normalized)) return false;
  }

  return null;
}

function pickExternalPowerPresent(source = {}) {
  const candidates = [
    source.externalPowerPresent,
    source.externalPower,
    source.powerPresent,
    source.acPower,
    source.usbPower,
    source.devicepower?.external?.present,
    source["devicepower:0"]?.external?.present
  ];

  for (const candidate of candidates) {
    const present = toPowerPresent(candidate);
    if (present !== null) return present;
  }

  return null;
}

function renderPowerStatus(prefix, isPresent) {
  const value = document.getElementById(`${prefix}PowerStatus`);
  if (!value) return;

  const present = toPowerPresent(isPresent);

  if (present === null) {
    value.className = "power-status unknown";
    value.title = "External power status unknown";
    value.setAttribute("aria-label", "External power status unknown");
    return;
  }

  value.className = `power-status ${present ? "connected" : "disconnected"}`;
  value.title = present ? "External power connected" : "External power disconnected";
  value.setAttribute("aria-label", value.title);
}

function renderCableStatus(prefix, isUnplugged) {
  const value = document.getElementById(`${prefix}CableStatus`);
  if (!value) return;

  if (isUnplugged !== true && isUnplugged !== false) {
    value.className = "power-status unknown";
    value.title = "Flood cable status unknown";
    value.setAttribute("aria-label", "Flood cable status unknown");
    return;
  }

  value.className = `power-status ${isUnplugged ? "disconnected" : "connected"}`;
  value.title = isUnplugged ? "Flood cable unplugged" : "Flood cable connected";
  value.setAttribute("aria-label", value.title);
}

function renderDeviceStatusMeta() {
  const meta = document.getElementById("deviceStatusMeta");
  if (!meta) return;

  const updates = [
    { time: latestHt3Update, source: "HT3" },
    {
      time: latestFloodState?.updatedAt ? new Date(latestFloodState.updatedAt).getTime() : null,
      source: "Flood"
    }
  ].filter((item) => Number.isFinite(item.time));

  if (!updates.length) {
    meta.textContent = "Last update: —";
    return;
  }

  const latest = updates.reduce((newest, item) => item.time > newest.time ? item : newest);
  meta.textContent = `Last update: ${formatDateTime(latest.time)} from ${latest.source}`;
}

function renderBatteryStatus(prefix, percentValue) {
  const icon = document.getElementById(`${prefix}BatteryIcon`);
  const value = document.getElementById(`${prefix}BatteryValue`);
  if (!icon || !value) return;

  const percent = toBatteryPercent(percentValue);

  if (percent === null) {
    icon.className = "battery-icon unknown";
    value.textContent = "—";
    return;
  }

  const level = Math.max(1, Math.ceil(percent / 25));
  const state = percent <= 10 ? "critical" : percent <= 25 ? "warning" : "";

  icon.className = `battery-icon level-${level}${state ? ` ${state}` : ""}`;
  value.textContent = `${percent}%`;
}

function setSwitchStatus(buttonId, valueId, cloudId, label, isOn, options = {}) {
  const button = document.getElementById(buttonId);
  const value = document.getElementById(valueId);
  const cloud = document.getElementById(cloudId);
  if (!button || !value) return;

  const known = typeof isOn === "boolean";
  const isOnline = options.online !== false;
  button.className = `iot-switch ${known && isOn ? "on" : "off"}`;
  button.disabled = Boolean(options.pending) || !isOnline;
  button.setAttribute("aria-pressed", String(known && isOn));
  button.setAttribute("aria-label", `${label} is ${isOnline ? (known ? (isOn ? "on" : "off") : "unknown") : "offline"}`);
  value.textContent = isOnline ? (known ? (isOn ? "ON" : "OFF") : "—") : "OFFLINE";

  if (cloud) {
    cloud.className = `cloud-status ${isOnline ? "online" : "offline"}`;
    cloud.title = `${label} ${isOnline ? "online" : "offline"}`;
    cloud.setAttribute("aria-label", cloud.title);
  }
}

function setPowerIotStatus(isOn, options = {}) {
  setSwitchStatus("powerIotSwitch", "powerIotStatus", "powerIotCloud", POWER_IOT_DEVICE_ID, isOn, options);
}

function setDehumidifierStatus(isOn, options = {}) {
  setSwitchStatus("dehumidifierSwitch", "dehumidifierStatus", "dehumidifierCloud", "Dehumidifier", isOn, options);
}

function formatChf(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("de-CH", {
    style: "currency",
    currency: "CHF",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(n);
}

function formatKwh(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("de-CH", {
    minimumFractionDigits: n < 1 ? 3 : 2,
    maximumFractionDigits: n < 1 ? 3 : 2
  }).format(n);
}

function formatWatts(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("de-CH", {
    maximumFractionDigits: n < 10 ? 1 : 0
  }).format(n);
}

function formatPowerWatts(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return formatWatts(Math.abs(n));
}

function positivePowerWatts(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.abs(n) : null;
}

function formatAmps(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("de-CH", {
    minimumFractionDigits: n < 1 ? 3 : 2,
    maximumFractionDigits: n < 1 ? 3 : 2
  }).format(n);
}

function renderEnergyYearList() {
  const list = document.getElementById("energyYearList");
  if (!list) return;

  const currentYear = new Date().getFullYear();
  const energyByYear = new Map((latestPowerIotState.annualCosts || [])
    .filter(item => Number(item.year) <= currentYear)
    .map(item => [String(item.year), item]));
  const awsByYear = new Map((latestAuditCosts.annualCosts || [])
    .filter(item => Number(item.year) <= currentYear)
    .map(item => [String(item.year), item]));
  const years = [...new Set([...energyByYear.keys(), ...awsByYear.keys()])]
    .sort((a, b) => Number(a) - Number(b));

  if (!years.length) {
    list.innerHTML = "";
    return;
  }

  list.innerHTML = `
    <div class="energy-year-row energy-year-header">
      <span>Year</span>
      <span>AWS</span>
      <span>Energy</span>
      <span>Total</span>
    </div>
    ${years.map(year => {
      const energy = energyByYear.get(year) || {};
      const aws = awsByYear.get(year) || {};
      const energyCost = Number(energy.costChf || 0);
      const awsCost = Number(aws.amount || 0);
      const total = awsCost + energyCost;

      return `
    <div class="energy-year-row">
      <span>Costs ${year}</span>
      <strong>${formatMoney(awsCost, aws.currency || latestAuditCosts.currency || "USD")}</strong>
      <strong>${formatChf(energyCost)}</strong>
      <strong>${formatMoney(total, aws.currency || latestAuditCosts.currency || "USD")}</strong>
    </div>
      `;
    }).join("")}
  `;
}

function renderPowerIotState(state = {}) {
  latestPowerIotState = state;
  const isOn = state.output === true || state.status === "on";
  const isOff = state.output === false || state.status === "off";

  setPowerIotStatus(isOn ? true : isOff ? false : null, { online: state.cloudConnected !== false });

  setText("energyCurrentPower", formatPowerWatts(state.apower));
  setText("energyCurrentMeta", Number.isFinite(Number(state.voltage)) ? `${formatWatts(state.voltage)} V · ${formatAmps(state.current)} A` : "Live reading");
  setText("energyMonthEstimate", formatChf(state.monthEstimateChf));
  setText("energyMonthMeta", `${formatKwh(state.monthEstimateKwh)} kWh estimate · ${formatChf(state.tariffChfPerKwh)}/kWh`);
  setText("energyTotalCost", formatChf(state.totalSinceStartCostChf));
  setText("energyTotalMeta", state.energyPeriodStartAt ? `Since ${formatDateTime(state.energyPeriodStartAt)}` : "Since reset");
  setText("energyTotalKwh", formatKwh(state.totalSinceStartKwh));
  setText("energyTotalKwhMeta", state.energyPeriodStartAt ? `Since ${formatDateTime(state.energyPeriodStartAt)}` : "Since reset");
  renderEnergyYearList();
  renderDehumidifierState(latestDehumidifierState);
}

async function loadPowerIotState() {
  try {
    const response = await fetch(`${API_BASE_URL}/power-iot`);
    if (!response.ok) throw new Error(`Power IoT API returned HTTP ${response.status}`);

    renderPowerIotState(await response.json());
  } catch (error) {
    console.error(error);
    renderPowerIotState({});
  }
}

async function setPowerIotOutput(on) {
  setPowerIotStatus(on, { pending: true });

  try {
    const response = await fetch(`${API_BASE_URL}/power-iot`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ on })
    });

    if (!response.ok) throw new Error(`Power IoT API returned HTTP ${response.status}`);
    renderPowerIotState(await response.json());
  } catch (error) {
    console.error(error);
    renderPowerIotState(latestPowerIotState);
  }
}

function bindPowerIotControl() {
  const button = document.getElementById("powerIotSwitch");
  if (!button) return;

  button.addEventListener("click", () => {
    setPowerIotOutput(button.getAttribute("aria-pressed") !== "true");
  });
}

function renderDehumidifierState(state = {}) {
  latestDehumidifierState = state;
  const relayOn = state.output === true || state.status === "on";
  const relayOff = state.output === false || state.status === "off";
  const plugWatts = positivePowerWatts(latestPowerIotState.apower);
  const hasPlugPower = plugWatts !== null;
  const isOn = relayOn && hasPlugPower && plugWatts > DEHUMIDIFIER_ACTIVE_WATTS;
  const isOff = relayOff || (relayOn && hasPlugPower && plugWatts < DEHUMIDIFIER_ACTIVE_WATTS);

  setDehumidifierStatus(isOn ? true : isOff ? false : null, { online: state.cloudConnected !== false });
}

async function loadDehumidifierState() {
  try {
    const response = await fetch(`${API_BASE_URL}/power-iot?device=${encodeURIComponent(DEHUMIDIFIER_DEVICE_ID)}`);
    if (!response.ok) throw new Error(`Dehumidifier API returned HTTP ${response.status}`);

    renderDehumidifierState(await response.json());
  } catch (error) {
    console.error(error);
    renderDehumidifierState({ cloudConnected: false });
  }
}

async function setDehumidifierOutput(on) {
  setDehumidifierStatus(on, { pending: true });

  try {
    const response = await fetch(`${API_BASE_URL}/power-iot?device=${encodeURIComponent(DEHUMIDIFIER_DEVICE_ID)}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ device: DEHUMIDIFIER_DEVICE_ID, on })
    });

    if (!response.ok) throw new Error(`Dehumidifier API returned HTTP ${response.status}`);
    renderDehumidifierState(await response.json());
    await loadPowerIotState();
  } catch (error) {
    console.error(error);
    renderDehumidifierState(latestDehumidifierState);
  }
}

function bindDehumidifierControl() {
  const button = document.getElementById("dehumidifierSwitch");
  if (!button) return;

  button.addEventListener("click", () => {
    setDehumidifierOutput(button.getAttribute("aria-pressed") !== "true");
  });
}

function formatMoney(amount, currency = "USD") {
  const value = Number(amount);
  if (!Number.isFinite(value)) return "—";

  return new Intl.NumberFormat("de-CH", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

function formatDateShort(value) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString("de-CH", {
    day: "2-digit",
    month: "2-digit"
  });
}

function renderAuditCosts(data = {}) {
  latestAuditCosts = data;
  const currency = data.currency || "USD";
  const lastDay = data.lastDay || {};
  const topService = data.topService || {};

  setText("auditMonthCost", formatMoney(data.monthToDate, currency));
  setText("auditDailyCost", formatMoney(data.dailyAverage, currency));
  setText("auditLastDayCost", formatMoney(lastDay.amount, currency));
  setText("auditTopServiceCost", formatMoney(topService.amount, currency));

  setText("auditMonthCostMeta", data.updatedAt ? `Updated: ${formatDateTime(data.updatedAt)}` : "Loaded");
  setText("auditDailyCostMeta", "Current month average");
  setText("auditLastDayMeta", lastDay.date ? `${formatDateShort(lastDay.date)}${lastDay.estimated ? " · estimated" : ""}` : "No daily cost data");
  setText("auditTopServiceMeta", topService.name || "No service data");
  renderEnergyYearList();
}

function renderAuditCostsError(message) {
  latestAuditCosts = {};
  setText("auditMonthCost", "—");
  setText("auditDailyCost", "—");
  setText("auditLastDayCost", "—");
  setText("auditTopServiceCost", "—");
  setText("auditMonthCostMeta", message || "Cost API error");
  setText("auditDailyCostMeta", "Cost unavailable");
  setText("auditLastDayMeta", "Cost unavailable");
  setText("auditTopServiceMeta", "Cost unavailable");
  renderEnergyYearList();
}

async function loadAuditCosts() {
  try {
    const response = await fetch(`${API_BASE_URL}/audit-costs`);
    if (!response.ok) throw new Error(`Cost API returned HTTP ${response.status}`);

    renderAuditCosts(await response.json());
  } catch (error) {
    console.error(error);
    renderAuditCostsError(error.message);
  }
}

function chartPointColor(values, checkFn, normalColor) {
  return values.map(value => checkFn(value) ? "#fb7185" : normalColor);
}

function chartPointRadius(values, checkFn) {
  return values.map(value => checkFn(value) ? 5 : 2);
}

async function loadThresholds() {
  try {
    const response = await fetch(`${API_BASE_URL}/thresholds`);
    if (!response.ok) throw new Error(`Threshold API returned HTTP ${response.status}`);

    const data = await response.json();

    LIMITS = {
      minTemperature: Number(data.minTemperature),
      maxTemperature: Number(data.maxTemperature),
      minHumidity: Number(data.minHumidity),
      maxHumidity: Number(data.maxHumidity),
      cooldownHours: Number(data.cooldownHours || 24)
    };

    renderThresholdInputs();
  } catch (error) {
    console.error(error);
    setError(`Threshold API error: ${error.message}`);
    renderThresholdInputs();
  }
}

function renderThresholdInputs() {
  document.getElementById("minTempInput").value = LIMITS.minTemperature;
  document.getElementById("maxTempInput").value = LIMITS.maxTemperature;
  document.getElementById("minHumidityInput").value = LIMITS.minHumidity;
  document.getElementById("maxHumidityInput").value = LIMITS.maxHumidity;
  document.getElementById("cooldownInput").value = LIMITS.cooldownHours || 24;
}

function getLimitsFromInputs() {
  return {
    minTemperature: Number(document.getElementById("minTempInput").value),
    maxTemperature: Number(document.getElementById("maxTempInput").value),
    minHumidity: Number(document.getElementById("minHumidityInput").value),
    maxHumidity: Number(document.getElementById("maxHumidityInput").value),
    cooldownHours: Number(document.getElementById("cooldownInput").value)
  };
}

function validateLimits(newLimits) {
  if (
    !Number.isFinite(newLimits.minTemperature) ||
    !Number.isFinite(newLimits.maxTemperature) ||
    !Number.isFinite(newLimits.minHumidity) ||
    !Number.isFinite(newLimits.maxHumidity) ||
    !Number.isFinite(newLimits.cooldownHours)
  ) {
    setError("Please enter valid threshold numbers.");
    return false;
  }

  if (newLimits.minTemperature > newLimits.maxTemperature) {
    setError("Temperature min cannot be greater than temperature max.");
    return false;
  }

  if (newLimits.minHumidity > newLimits.maxHumidity) {
    setError("Humidity min cannot be greater than humidity max.");
    return false;
  }

  return true;
}

async function saveThresholds(resetCooldown = false) {
  const newLimits = getLimitsFromInputs();
  if (!validateLimits(newLimits)) return;

  try {
    document.querySelectorAll(".threshold-grid input").forEach(input => {
      input.disabled = true;
    });

    const response = await fetch(`${API_BASE_URL}/thresholds`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...newLimits, resetCooldown })
    });

    if (!response.ok) throw new Error(`Threshold API returned HTTP ${response.status}`);

    const saved = await response.json();

    LIMITS = {
      minTemperature: Number(saved.minTemperature),
      maxTemperature: Number(saved.maxTemperature),
      minHumidity: Number(saved.minHumidity),
      maxHumidity: Number(saved.maxHumidity),
      cooldownHours: Number(saved.cooldownHours || newLimits.cooldownHours)
    };

    setError("");
    renderThresholdInputs();
    await loadData();
  } catch (error) {
    console.error(error);
    setError(`Could not save thresholds: ${error.message}`);
  } finally {
    document.querySelectorAll(".threshold-grid input").forEach(input => {
      input.disabled = false;
    });
  }
}

async function applyCooldown() {
  const newLimits = getLimitsFromInputs();
  if (!validateLimits(newLimits)) return;

  try {
    const cooldownInput = document.getElementById("cooldownInput");
    cooldownInput.disabled = true;

    const response = await fetch(`${API_BASE_URL}/thresholds`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...newLimits, resetCooldown: false })
    });

    if (!response.ok) throw new Error(`Cooldown update failed: HTTP ${response.status}`);

    const saved = await response.json();

    LIMITS = {
      minTemperature: Number(saved.minTemperature),
      maxTemperature: Number(saved.maxTemperature),
      minHumidity: Number(saved.minHumidity),
      maxHumidity: Number(saved.maxHumidity),
      cooldownHours: Number(saved.cooldownHours || newLimits.cooldownHours)
    };

    setError("");
    renderThresholdInputs();
  } catch (error) {
    console.error(error);
    setError(`Cooldown update failed: ${error.message}`);
  } finally {
    document.getElementById("cooldownInput").disabled = false;
  }
}

async function resetCooldown() {
  const newLimits = {
    ...getLimitsFromInputs(),
    cooldownHours: 6
  };

  document.getElementById("cooldownInput").value = 6;

  if (!validateLimits(newLimits)) return;

  try {
    const resetBtn = document.getElementById("resetCooldownButton");
    resetBtn.disabled = true;
    resetBtn.textContent = "Resetting…";

    const response = await fetch(`${API_BASE_URL}/thresholds`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...newLimits, resetCooldown: true })
    });

    if (!response.ok) throw new Error(`Reset failed: HTTP ${response.status}`);

    const saved = await response.json();

    LIMITS = {
      minTemperature: Number(saved.minTemperature),
      maxTemperature: Number(saved.maxTemperature),
      minHumidity: Number(saved.minHumidity),
      maxHumidity: Number(saved.maxHumidity),
      cooldownHours: Number(saved.cooldownHours || 6)
    };

    setError("");
    renderThresholdInputs();
    await loadData();
  } catch (error) {
    console.error(error);
    setError(`Could not reset cooldown: ${error.message}`);
  } finally {
    const resetBtn = document.getElementById("resetCooldownButton");
    resetBtn.disabled = false;
    resetBtn.textContent = "Reset";
  }
}

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: "index", intersect: false },
  plugins: {
    legend: { labels: { color: "#cbd5e1" } },
    tooltip: {
      backgroundColor: "rgba(15, 23, 42, 0.95)",
      borderColor: "rgba(255,255,255,0.14)",
      borderWidth: 1,
      titleColor: "#f8fafc",
      bodyColor: "#cbd5e1"
    }
  },
  scales: {
    x: {
      ticks: {
        color: "#94a3b8",
        maxRotation: 0,
        autoSkip: true,
        maxTicksLimit: 8,
        callback: function(value) {
          const label = this.getLabelForValue(value);
          return label.includes(" ") ? label.split(" ") : label;
        }
      },
      grid: { color: "rgba(148, 163, 184, 0.10)" }
    },
    y: {
      ticks: { color: "#94a3b8" },
      grid: { color: "rgba(148, 163, 184, 0.10)" }
    }
  }
};

function formatTime(seconds) {
  const d = new Date(seconds * 1000);
  const date = d.toLocaleDateString(undefined, { day: "2-digit", month: "2-digit" });
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return `${date} ${time}`;
}

function formatTimeInline(seconds) {
  return formatDateTime(seconds * 1000);
}

function formatDateOnly(seconds) {
  return new Date(seconds * 1000).toLocaleDateString(undefined, { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatTimeOnly(seconds) {
  return new Date(seconds * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function formatDateTime(value) {
  return new Date(value).toLocaleString("de-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatVideoTimestamp(ms) {
  const totalSeconds = Math.floor(Number(ms || 0) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = Number(bytes);
  let index = 0;

  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index++;
  }

  return `${value.toFixed(1)} ${units[index]}`;
}

function setError(message) {
  const box = document.getElementById("errorBox");
  const statusRow = document.querySelector(".status-row");
  const statusDot = document.getElementById("statusDot");
  const statusText = document.getElementById("statusText");

  if (box) {
    box.textContent = "";
    box.style.display = "none";
  }

  statusRow?.classList.toggle("status-error", Boolean(message));

  if (message) {
    statusDot?.classList.remove("online");
    statusDot?.classList.add("alert");
    statusText.textContent = `Offline or API error · ${message}`;
  }
}

function renderCharts(labels, temperatures, humidities) {
  if (tempChart) tempChart.destroy();
  if (humidityChart) humidityChart.destroy();

  tempChart = new Chart(document.getElementById("tempChart"), {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Temperature °C",
        data: temperatures,
        borderColor: "#f59e0b",
        backgroundColor: "rgba(245, 158, 11, 0.12)",
        pointBackgroundColor: chartPointColor(temperatures, isTemperatureAlert, "#f59e0b"),
        pointBorderColor: chartPointColor(temperatures, isTemperatureAlert, "#f59e0b"),
        pointRadius: chartPointRadius(temperatures, isTemperatureAlert),
        pointHoverRadius: 6,
        tension: 0.38,
        fill: true
      }]
    },
    options: chartOptions
  });

  humidityChart = new Chart(document.getElementById("humidityChart"), {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Humidity %",
        data: humidities,
        borderColor: "#2dd4bf",
        backgroundColor: "rgba(45, 212, 191, 0.12)",
        pointBackgroundColor: chartPointColor(humidities, isHumidityAlert, "#2dd4bf"),
        pointBorderColor: chartPointColor(humidities, isHumidityAlert, "#2dd4bf"),
        pointRadius: chartPointRadius(humidities, isHumidityAlert),
        pointHoverRadius: 6,
        tension: 0.38,
        fill: true
      }]
    },
    options: chartOptions
  });
}

function renderTable(items) {
  const tbody = document.getElementById("readingsTable");

  tbody.innerHTML = items.slice(-10).reverse().map(item => {
    const temperature = Number(item.temperature);
    const humidity = Number(item.humidity);
    const tempAlert = isTemperatureAlert(temperature);
    const humidityAlert = isHumidityAlert(humidity);
    const rowAlert = tempAlert || humidityAlert;

    return `
      <tr class="${rowAlert ? "threshold-row-alert" : ""}">
        <td data-label="Time">${formatTimeInline(item.eventtime)}</td>
        <td data-label="Temperature" class="${thresholdClass(tempAlert)}">
          ${temperature.toFixed(1)} °C
          ${tempAlert ? `<span class="threshold-pill">Alert</span>` : ""}
        </td>
        <td data-label="Humidity" class="${thresholdClass(humidityAlert)}">
          ${humidity.toFixed(1)} %
          ${humidityAlert ? `<span class="threshold-pill">Alert</span>` : ""}
        </td>
      </tr>
    `;
  }).join("");
}

function getLocalDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function setupDefaultDateRange() {
}

function getSelectedHoursForApi() {
  return document.getElementById("rangeModeSelect").value;
}

function filterItemsBySelectedRange(items) {
  return items;
}

function getSelectedRangeLabel() {
  const selected = document.getElementById("rangeModeSelect");
  return selected.options[selected.selectedIndex].text;
}

function handleRangeModeChange() {
  loadData();
}

async function loadData() {
  const hours = getSelectedHoursForApi();
  const url = `${API_BASE_URL}/measurements?deviceId=${encodeURIComponent(DEVICE_ID)}&hours=${hours}`;

  document.getElementById("statusText").textContent = "Loading data…";
  document.getElementById("statusDot").classList.remove("online", "alert");
  setError("");

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`API returned HTTP ${response.status}`);

    const data = await response.json();
    const allItems = (data.items || []).sort((a, b) => a.eventtime - b.eventtime);
    const items = filterItemsBySelectedRange(allItems);

    if (!items.length) {
      throw new Error(`No measurements found for selected range: ${getSelectedRangeLabel()}.`);
    }

    const latest = items[items.length - 1];
    const labels = items.map(x => formatTime(x.eventtime));
    const temperatures = items.map(x => Number(x.temperature));
    const humidities = items.map(x => Number(x.humidity));

    const latestTempAlert = isTemperatureAlert(latest.temperature);
    const latestHumidityAlert = isHumidityAlert(latest.humidity);
    const latestAlert = latestTempAlert || latestHumidityAlert;

    const currentTemp = document.getElementById("currentTemp");
    const currentHumidity = document.getElementById("currentHumidity");

    currentTemp.textContent = Number(latest.temperature).toFixed(1);
    currentTemp.className = thresholdClass(latestTempAlert);

    currentHumidity.textContent = Number(latest.humidity).toFixed(1);
    currentHumidity.className = thresholdClass(latestHumidityAlert);

    renderBatteryStatus("ht3", pickBatteryPercent(latest));
    renderPowerStatus("ht3", pickExternalPowerPresent(latest));

    const latestReadingTime = formatTimeInline(latest.eventtime);
    latestHt3Update = latest.eventtime * 1000;
    renderDeviceStatusMeta();
    document.getElementById("tempTrend").textContent = `Last update: ${latestReadingTime}`;
    document.getElementById("humidityTrend").textContent = `Last update: ${latestReadingTime}`;

    document.getElementById("tempThresholdInfo").textContent = `Limits: ${LIMITS.minTemperature}–${LIMITS.maxTemperature} °C`;
    document.getElementById("humidityThresholdInfo").textContent = `Limits: ${LIMITS.minHumidity}–${LIMITS.maxHumidity} %`;

    if (latestAlert) {
      document.getElementById("statusText").textContent = "Online · Current value threshold alert";
      document.getElementById("statusDot").classList.add("alert");
    } else {
      document.getElementById("statusText").textContent = "Online · API reachable";
      document.getElementById("statusDot").classList.add("online");
    }

    document.getElementById("lastUpdated").textContent = `Last updated: ${new Date().toLocaleTimeString()} · Range: ${getSelectedRangeLabel()}`;

    renderCharts(labels, temperatures, humidities);
    renderTable(items);
  } catch (error) {
    console.error(error);
    document.getElementById("statusText").textContent = "Offline or API error";
    setError(error.message);
    renderBatteryStatus("ht3", null);
    renderPowerStatus("ht3", null);
    latestHt3Update = null;
    renderDeviceStatusMeta();
  }
}

async function loadVideos() {
  const url = `${API_BASE_URL}/videos`;
  document.getElementById("videoStatus").textContent = "Videos: loading…";

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Video API returned HTTP ${response.status}`);

    const data = await response.json();
    videos = data.items || [];

    document.getElementById("videoStatus").textContent = `Videos: ${videos.length} available`;
  } catch (error) {
    console.error(error);
    document.getElementById("videoStatus").textContent = "Videos: API error";
  }
}

async function loadEvents() {
  const url = `${API_BASE_URL}/events`;

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Events API returned HTTP ${response.status}`);

    const data = await response.json();
    events = (data.items || []).filter(item => item.bucketMs === 10000);
    eventPage = 1;
    eventDayOpenState = {};

    renderEventsTable(events);
  } catch (error) {
    console.error(error);
  }
}

function getVideoForEvent(eventItem) {
  if (!eventItem || !eventItem.videoKey) return null;
  return videos.find(video => video.key === eventItem.videoKey) || null;
}

function getEventDateValue(eventItem) {
  const directCandidates = [
    eventItem.eventtime,
    eventItem.eventTime,
    eventItem.timestamp,
    eventItem.createdAt,
    eventItem.detectedAt,
    eventItem.ingestTs
  ];

  for (const candidate of directCandidates) {
    if (candidate === undefined || candidate === null || candidate === "") continue;

    if (typeof candidate === "number") {
      return new Date(candidate > 10_000_000_000 ? candidate : candidate * 1000);
    }

    const parsed = new Date(candidate);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  const video = getVideoForEvent(eventItem);
  if (video && video.lastModified) {
    const parsed = new Date(video.lastModified);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  return new Date();
}

function formatEventDay(date) {
  return date.toLocaleDateString("de-CH", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
}

function formatEventClock(date) {
  return date.toLocaleTimeString("de-CH", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getEventGroupTitle(videoEvents) {
  const priority = [
    "Person",
    "Cat",
    "Dog",
    "Feline",
    "Canine",
    "Animal",
    "Bird",
    "Mammal",
    "Vehicle",
    "Car",
    "Bicycle",
    "Backpack",
    "Bag"
  ];

  const labels = videoEvents
    .map(item => ({
      label: String(item.label || "Unknown"),
      confidence: Number(item.confidence || 0)
    }))
    .sort((a, b) => b.confidence - a.confidence);

  const uniqueLabels = [];
  labels.forEach(item => {
    if (!uniqueLabels.some(existing => existing.label === item.label)) {
      uniqueLabels.push(item);
    }
  });

  const priorityMatch = priority
    .map(label => uniqueLabels.find(item => item.label.toLowerCase() === label.toLowerCase()))
    .find(Boolean);

  const main = priorityMatch || uniqueLabels[0] || { label: "Detected Event", confidence: 0 };

  const hasPerson = uniqueLabels.some(item => item.label.toLowerCase() === "person");
  const hasAnimal = uniqueLabels.some(item =>
    ["cat", "dog", "animal", "feline", "canine", "bird", "mammal"].includes(item.label.toLowerCase())
  );

  if (hasPerson && hasAnimal) return "Person & Animal detected";
  if (main.label.toLowerCase() === "person") return "Person detected";
  if (["cat", "dog", "animal", "feline", "canine", "bird", "mammal"].includes(main.label.toLowerCase())) {
    return `${main.label} detected`;
  }

  return `${main.label} detected`;
}

function getEventLabels(videoEvents) {
  const byLabel = {};

  videoEvents.forEach(item => {
    if (Array.isArray(item.detectedLabelDetails) && item.detectedLabelDetails.length) {
      item.detectedLabelDetails.forEach(detail => {
        const label = String(detail.name || detail.label || "Unknown");
        const confidence = Number(detail.confidence || 0);

        if (!byLabel[label] || confidence > byLabel[label]) {
          byLabel[label] = confidence;
        }
      });
      return;
    }

    if (Array.isArray(item.detectedLabels) && item.detectedLabels.length) {
      item.detectedLabels.forEach(labelName => {
        const label = String(labelName || "Unknown");
        const confidence = Number(item.confidence || 0);

        if (!byLabel[label] || confidence > byLabel[label]) {
          byLabel[label] = confidence;
        }
      });
      return;
    }

    const label = String(item.label || "Unknown");
    const confidence = Number(item.confidence || 0);

    if (!byLabel[label] || confidence > byLabel[label]) {
      byLabel[label] = confidence;
    }
  });

  return Object.entries(byLabel)
    .map(([label, confidence]) => ({ label, confidence }))
    .sort((a, b) => b.confidence - a.confidence);
}

function getConfidenceChipStyle(confidenceValue) {
  const confidence = Math.max(0, Math.min(100, Number(confidenceValue) || 0));
  const lightness = Math.min(92, 79 + ((100 - confidence) * 0.6));
  const backgroundAlpha = Math.max(0.06, 0.14 - ((100 - confidence) * 0.004));

  return [
    `color: hsl(166 84% ${lightness.toFixed(1)}%)`,
    `border-color: hsl(166 84% ${Math.max(52, lightness - 20).toFixed(1)}% / 0.32)`,
    `background: hsl(166 84% ${lightness.toFixed(1)}% / ${backgroundAlpha.toFixed(2)})`
  ].join(";");
}

function getEventGroups(items) {
  const groupedByVideo = items.reduce((groups, item) => {
    const key = item.videoKey || "unknown-video";
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
    return groups;
  }, {});

  return Object.entries(groupedByVideo).map(([videoKey, videoEvents]) => {
    const sortedEvents = videoEvents
      .slice()
      .sort((a, b) => Number(a.rekognitionTimestampMs || 0) - Number(b.rekognitionTimestampMs || 0));

    const firstEvent = sortedEvents[0];
    const eventDate = getEventDateValue(firstEvent);

    return {
      videoKey,
      date: eventDate,
      dayKey: getLocalDateString(eventDate),
      events: sortedEvents
    };
  }).sort((a, b) => b.date - a.date);
}

function getPaginatedEventGroups(items) {
  const groups = getEventGroups(items);
  const totalPages = Math.max(1, Math.ceil(groups.length / EVENTS_PER_PAGE));

  if (eventPage > totalPages) eventPage = totalPages;
  if (eventPage < 1) eventPage = 1;

  const start = (eventPage - 1) * EVENTS_PER_PAGE;
  const end = start + EVENTS_PER_PAGE;

  return {
    groups: groups.slice(start, end),
    totalGroups: groups.length,
    totalPages
  };
}

function setDefaultOpenEventDay(groups) {
  if (!groups.length || Object.keys(eventDayOpenState).length) return;

  eventDayOpenState[groups[0].dayKey] = true;
}

function renderEventsPagination(totalPages) {
  const pagination = document.getElementById("eventsPagination");
  if (!pagination) return;

  if (totalPages <= 1) {
    pagination.innerHTML = "";
    return;
  }

  const pageNumbers = [];
  const maxVisiblePages = 7;

  if (totalPages <= maxVisiblePages) {
    for (let page = 1; page <= totalPages; page++) pageNumbers.push(page);
  } else {
    pageNumbers.push(1);

    const start = Math.max(2, eventPage - 2);
    const end = Math.min(totalPages - 1, eventPage + 2);

    if (start > 2) pageNumbers.push("ellipsis-start");

    for (let page = start; page <= end; page++) pageNumbers.push(page);

    if (end < totalPages - 1) pageNumbers.push("ellipsis-end");

    pageNumbers.push(totalPages);
  }

  let buttons = `
    <button data-page-action="prev" ${eventPage === 1 ? "disabled" : ""}>←</button>
  `;

  pageNumbers.forEach(page => {
    if (typeof page === "string") {
      buttons += `<span class="pagination-ellipsis">…</span>`;
      return;
    }

    buttons += `
      <button class="${page === eventPage ? "active" : ""}" data-page="${page}">${page}</button>
    `;
  });

  buttons += `
    <button data-page-action="next" ${eventPage === totalPages ? "disabled" : ""}>→</button>
    <span class="pagination-info">Page ${eventPage} of ${totalPages}</span>
  `;

  pagination.innerHTML = buttons;

  pagination.querySelectorAll("button[data-page]").forEach(button => {
    button.addEventListener("click", () => {
      eventPage = Number(button.dataset.page);
      renderEventsTable(events);
    });
  });

  pagination.querySelectorAll("button[data-page-action]").forEach(button => {
    button.addEventListener("click", () => {
      const action = button.dataset.pageAction;
      eventPage += action === "next" ? 1 : -1;
      renderEventsTable(events);
    });
  });
}

function renderEventsTable(items) {
  const tbody = document.getElementById("eventsTable");

  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="4">No detected events found.</td></tr>`;
    renderEventsPagination(0);
    return;
  }

  const { groups, totalPages } = getPaginatedEventGroups(items);
  setDefaultOpenEventDay(getEventGroups(items));
  let currentDayKey = "";

  const rows = groups.map(group => {
    const sortedEvents = group.events;
    const firstEvent = sortedEvents[0];
    const originalIndex = events.indexOf(firstEvent);
    const detectionLabels = getEventLabels(sortedEvents);
    const title = getEventGroupTitle(sortedEvents);
    const bestConfidence = Math.max(...sortedEvents.map(item => Number(item.confidence || 0)));
    const isDayOpen = eventDayOpenState[group.dayKey] === true;

    const dayHeader = group.dayKey !== currentDayKey
      ? `
        <tr class="event-day-row">
          <td colspan="4">
            <button class="event-day-toggle" data-day-key="${group.dayKey}" aria-expanded="${isDayOpen}">
              <span class="event-day-title">${formatEventDay(group.date)}</span>
              <span class="event-day-chevron" aria-hidden="true">${isDayOpen ? "−" : "+"}</span>
            </button>
          </td>
        </tr>
      `
      : "";

    currentDayKey = group.dayKey;

    const labelChips = detectionLabels.map(item => `
      <span class="event-chip" style="${getConfidenceChipStyle(item.confidence)}">
        ${item.label} ${item.confidence.toFixed(0)}%
      </span>
    `).join("");

    return `
      ${dayHeader}
      <tr class="event-video-row ${isDayOpen ? "" : "event-day-collapsed"}" data-day-key="${group.dayKey}">
        <td data-label="Time">
          <span class="event-time">${formatEventClock(group.date)}</span>
        </td>
        <td data-label="Detected">
          <div class="event-summary">
            <div class="event-title-row">
              <div class="event-title">${title}</div>
            </div>
            <div class="event-tags">${labelChips}</div>
          </div>
        </td>
        <td data-label="Confidence"><span class="event-confidence">${bestConfidence.toFixed(1)} %</span></td>
        <td data-label="Play">
          <button data-event-index="${originalIndex}" class="play-event-button">Play</button>
        </td>
      </tr>
    `;
  }).join("");

  tbody.innerHTML = rows;
  renderEventsPagination(totalPages);

  tbody.querySelectorAll(".event-day-toggle").forEach(button => {
    button.addEventListener("click", () => {
      const dayKey = button.dataset.dayKey;
      eventDayOpenState[dayKey] = eventDayOpenState[dayKey] !== true;
      renderEventsTable(events);
    });
  });

  tbody.querySelectorAll(".play-event-button").forEach(button => {
    button.addEventListener("click", () => {
      playEvent(events[Number(button.dataset.eventIndex)]);
    });
  });
}

function toggleReadings() {
  const header = document.getElementById("readingsHeader");
  const content = document.getElementById("readingsContent");
  const toggle = document.getElementById("readingsToggle");
  const isOpen = !content.classList.contains("collapsed");

  content.classList.toggle("collapsed", isOpen);
  header.setAttribute("aria-expanded", String(!isOpen));
  toggle.textContent = isOpen ? "+" : "−";
}

function toggleSection(header) {
  const content = document.getElementById(header.dataset.sectionTarget);
  const toggle = document.getElementById(header.dataset.sectionToggle);
  if (!content || !toggle) return;

  const isOpen = !content.classList.contains("collapsed");
  const controls = header.querySelector(".measurement-controls");

  content.classList.toggle("collapsed", isOpen);
  if (controls) controls.hidden = isOpen;
  header.setAttribute("aria-expanded", String(!isOpen));
  toggle.textContent = isOpen ? "+" : "−";
}

function bindToggleHeader(header, handler) {
  header.addEventListener("click", handler);
  header.addEventListener("keydown", event => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    handler();
  });
}

function openVideoModal(eventItem, video, jumpToSeconds) {
  const modal = document.getElementById("videoModal");
  const player = document.getElementById("modalVideoPlayer");
  const title = document.getElementById("modalVideoTitle");
  const meta = document.getElementById("modalVideoMeta");

  const relatedEvents = events.filter(item => item.videoKey === eventItem.videoKey);
  const eventDate = getEventDateValue(eventItem);

  title.textContent = getEventGroupTitle(relatedEvents.length ? relatedEvents : [eventItem]);
  meta.textContent = `${formatEventDay(eventDate)} · ${formatEventClock(eventDate)} · ${formatVideoTimestamp(eventItem.rekognitionTimestampMs)}`;

  player.src = video.url;
  player.load();

  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");

  player.addEventListener("loadedmetadata", function jumpOnce() {
    player.currentTime = jumpToSeconds;
    player.play().catch(() => {});
    player.removeEventListener("loadedmetadata", jumpOnce);
  });
}

function closeVideoModal() {
  const modal = document.getElementById("videoModal");
  const player = document.getElementById("modalVideoPlayer");

  player.pause();
  player.removeAttribute("src");
  player.load();

  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
}

function playEvent(eventItem) {
  if (!eventItem || !videos.length) return;

  const video = videos.find(v => v.key === eventItem.videoKey);

  if (!video) {
    alert("Video not found in current video list.");
    return;
  }

  const jumpToSeconds = Math.max(0, Math.floor(Number(eventItem.rekognitionTimestampMs || 0) / 1000));
  openVideoModal(eventItem, video, jumpToSeconds);
}

function registerEventListeners() {
  bindToggleHeader(document.getElementById("readingsHeader"), toggleReadings);
  bindToggleHeader(document.getElementById("measurementsHeader"), () => toggleSection(document.getElementById("measurementsHeader")));
  bindToggleHeader(document.getElementById("surveillanceHeader"), () => toggleSection(document.getElementById("surveillanceHeader")));
  bindToggleHeader(document.getElementById("auditCostsHeader"), () => toggleSection(document.getElementById("auditCostsHeader")));
  bindPowerIotControl();
  bindDehumidifierControl();
  document.getElementById("rangeModeSelect").addEventListener("change", handleRangeModeChange);
  document.querySelector(".threshold-controls").addEventListener("click", event => event.stopPropagation());
  document.querySelector(".threshold-controls").addEventListener("keydown", event => event.stopPropagation());
  document.querySelectorAll(".threshold-grid input").forEach(input => {
    input.addEventListener("change", () => saveThresholds(false));
  });
  document.getElementById("cooldownInput").addEventListener("change", applyCooldown);
  document.getElementById("resetCooldownButton").addEventListener("click", resetCooldown);
  document.getElementById("closeVideoModal").addEventListener("click", closeVideoModal);

  document.getElementById("videoModal").addEventListener("click", event => {
    if (event.target.id === "videoModal") closeVideoModal();
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeVideoModal();
  });
}

async function init() {
  setupDefaultDateRange();
  registerEventListeners();

  await loadThresholds();
  await loadFloodState();
  await loadPowerIotState();
  await loadDehumidifierState();
  await loadVideos();
  await loadEvents();
  await loadAuditCosts();
  loadData();

  setInterval(loadData, 60_000);
  setInterval(loadFloodState, 60_000);
  setInterval(loadPowerIotState, 60_000);
  setInterval(loadDehumidifierState, 60_000);
  setInterval(loadVideos, 300_000);
  setInterval(loadEvents, 300_000);
  setInterval(loadAuditCosts, 1_800_000);
}

if (window.StorageRetschwilAuth) {
  window.StorageRetschwilAuth.bootstrap(init);
} else {
  init();
}
