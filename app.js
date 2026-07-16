const API_BASE_URL = "https://onbcgvleu4.execute-api.eu-central-1.amazonaws.com";
const DEVICE_ID = "shellyhtg3-e4b3232fa628";
const POWER_IOT_DEVICE_ID = "plugsstorageretschwil";
const DEHUMIDIFIER_DEVICE_ID = "dehumidifier";
const DEHUMIDIFIER_ON_WATTS = 200;
const DEHUMIDIFIER_OFF_WATTS = 10;
const DEHUMIDIFIER_TRANSITION_TIMEOUT_MS = 120_000;
const DEHUMIDIFIER_TRANSITION_POLL_MS = 5_000;
const LIVE_REFRESH_MS = 15_000;
const SURVEILLANCE_REFRESH_MS = 60_000;
const AUDIT_REFRESH_MS = 24 * 60 * 60_000;
const RANGE_PRESETS = [
  { value: "6", label: "Last 6h", shortLabel: "6h" },
  { value: "24", label: "Last 24h", shortLabel: "24h" },
  { value: "72", label: "Last 3 days", shortLabel: "3d" },
  { value: "168", label: "Last 7 days", shortLabel: "7d" },
  { value: "336", label: "Last 14 days", shortLabel: "14d" },
  { value: "720", label: "Last 30 days", shortLabel: "30d" }
];

let LIMITS = {
  maxTemperature: 20,
  minTemperature: 5,
  maxHumidity: 50,
  minHumidity: 0,
  measurementNotificationsEnabled: true,
  surveillanceNotificationsEnabled: true,
  deviceNotificationsEnabled: true
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
let lastFocusRefreshAt = 0;
let lastAuditRefreshAt = 0;
let dehumidifierTransition = null;
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

  status.classList.remove("loading-inline");
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
    const response = await apiFetch(`${API_BASE_URL}/flood`);
    if (!response.ok) throw new Error(`Flood API returned HTTP ${response.status}`);

    renderFloodState(await response.json());
  } catch (error) {
    console.error(error);
    const status = document.getElementById("floorFloodStatus");
    status.classList.remove("loading-inline");
    status.textContent = "Dry";
    status.className = thresholdClass(false);
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
  if (element) {
    element.classList.remove("loading-inline");
    element.textContent = value;
  }
}

function apiFetch(url, options = {}) {
  return fetch(url, {
    cache: "no-store",
    ...options,
    headers: {
      ...(options.headers || {})
    }
  });
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
  const ht3Update = document.getElementById("ht3DeviceUpdate");
  const floodUpdate = document.getElementById("floodDeviceUpdate");

  const updates = [
    { time: latestHt3Update, source: "HT3" },
    {
      time: latestFloodState?.updatedAt ? new Date(latestFloodState.updatedAt).getTime() : null,
      source: "Flood"
    }
  ].filter((item) => Number.isFinite(item.time));

  if (ht3Update) {
    ht3Update.textContent = latestHt3Update ? formatDeviceUpdateTime(latestHt3Update) : "—";
  }

  const floodTime = latestFloodState?.updatedAt ? new Date(latestFloodState.updatedAt).getTime() : null;
  if (floodUpdate) {
    floodUpdate.textContent = Number.isFinite(floodTime) ? formatDeviceUpdateTime(floodTime) : "—";
  }

  if (!meta) return;

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
    value.classList.remove("loading-inline");
    value.textContent = "—";
    return;
  }

  const level = Math.max(1, Math.ceil(percent / 25));
  const state = percent <= 10 ? "critical" : percent <= 25 ? "warning" : "";

  icon.className = `battery-icon level-${level}${state ? ` ${state}` : ""}`;
  value.classList.remove("loading-inline");
  value.textContent = `${percent}%`;
}

function setSwitchStatus(buttonId, valueId, cloudId, label, isOn, options = {}) {
  const button = document.getElementById(buttonId);
  const value = document.getElementById(valueId);
  const cloud = document.getElementById(cloudId);
  if (!button || !value) return;

  const known = typeof isOn === "boolean";
  const isOnline = options.online !== false;
  const pending = Boolean(options.pending) || (isOnline && !known);
  button.className = `iot-switch ${known && isOn ? "on" : "off"}${pending ? " pending" : ""}`;
  button.disabled = pending || !isOnline;
  button.setAttribute("aria-pressed", String(known && isOn));
  button.setAttribute("aria-label", `${label} is ${isOnline ? (known ? (isOn ? "on" : "off") : "unknown") : "offline"}`);
  value.textContent = isOnline ? (options.pendingLabel || (known ? (isOn ? "ON" : "OFF") : "—")) : "OFFLINE";

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

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getDehumidifierPowerState() {
  const plugWatts = positivePowerWatts(latestPowerIotState.apower);
  if (plugWatts === null) return null;
  if (plugWatts > DEHUMIDIFIER_ON_WATTS) return true;
  if (plugWatts < DEHUMIDIFIER_OFF_WATTS) return false;
  return null;
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
    const response = await apiFetch(`${API_BASE_URL}/power-iot`);
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
    const response = await apiFetch(`${API_BASE_URL}/power-iot`, {
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
  const powerState = getDehumidifierPowerState();
  const now = Date.now();
  const transition = dehumidifierTransition;
  const transitionResolved = transition && powerState === transition.target;
  const transitionActive = transition && !transitionResolved && now - transition.startedAt < DEHUMIDIFIER_TRANSITION_TIMEOUT_MS;

  if (transitionResolved || (transition && !transitionActive)) {
    dehumidifierTransition = null;
  }

  setDehumidifierStatus(powerState, {
    online: state.cloudConnected !== false,
    pending: Boolean(transitionActive),
    pendingLabel: transitionActive ? (transition.target ? "WAIT ON" : "WAIT OFF") : null
  });

  const automationTag = document.getElementById("dehumidifierAutomationTag");
  if (automationTag) {
    const activeSince = state.automationActiveSince ? new Date(state.automationActiveSince) : null;
    const showAutomationTag = state.automationActive === true &&
      powerState === true &&
      activeSince &&
      !Number.isNaN(activeSince.getTime());

    automationTag.hidden = !showAutomationTag;
    automationTag.textContent = showAutomationTag
      ? `Active by Automation since: ${activeSince.toLocaleTimeString("de-CH", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/Zurich"
      })}`
      : "";
  }
}

async function loadDehumidifierState() {
  try {
    const response = await apiFetch(`${API_BASE_URL}/power-iot?device=${encodeURIComponent(DEHUMIDIFIER_DEVICE_ID)}`);
    if (!response.ok) throw new Error(`Dehumidifier API returned HTTP ${response.status}`);

    renderDehumidifierState(await response.json());
  } catch (error) {
    console.error(error);
    renderDehumidifierState({ cloudConnected: false });
  }
}

async function setDehumidifierOutput(on) {
  dehumidifierTransition = {
    target: on,
    startedAt: Date.now()
  };
  renderDehumidifierState(latestDehumidifierState);

  try {
    const response = await apiFetch(`${API_BASE_URL}/power-iot?device=${encodeURIComponent(DEHUMIDIFIER_DEVICE_ID)}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ device: DEHUMIDIFIER_DEVICE_ID, on })
    });

    if (!response.ok) throw new Error(`Dehumidifier API returned HTTP ${response.status}`);
    latestDehumidifierState = await response.json();
    await waitForDehumidifierPowerState(on);
  } catch (error) {
    console.error(error);
    dehumidifierTransition = null;
    renderDehumidifierState(latestDehumidifierState);
  }
}

async function waitForDehumidifierPowerState(target) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < DEHUMIDIFIER_TRANSITION_TIMEOUT_MS) {
    await delay(DEHUMIDIFIER_TRANSITION_POLL_MS);
    await loadPowerIotState();

    if (getDehumidifierPowerState() === target) {
      dehumidifierTransition = null;
      renderDehumidifierState(latestDehumidifierState);
      return;
    }
  }

  dehumidifierTransition = null;
  renderDehumidifierState(latestDehumidifierState);
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
  setText("auditTopServiceCost", formatMoney(data.monthEstimate, currency));

  setText("auditMonthCostMeta", data.updatedAt ? `Updated: ${formatDateTime(data.updatedAt)}` : "Loaded");
  setText("auditDailyCostMeta", "Current month average");
  setText("auditLastDayMeta", lastDay.date ? `${formatDateShort(lastDay.date)}${lastDay.estimated ? " · estimated" : ""}` : "No daily cost data");
  setText("auditTopServiceMeta", topService.name ? `Top driver: ${topService.name}` : "Estimated month");
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
    lastAuditRefreshAt = Date.now();
    const response = await apiFetch(`${API_BASE_URL}/audit-costs`);
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
  const count = values.length;
  const normalRadius = count > 260 ? 0 : count > 140 ? 0.75 : count > 80 ? 1.25 : 2;
  const alertRadius = count > 260 ? 2.5 : count > 140 ? 3 : count > 80 ? 3.5 : 4.5;

  return values.map(value => checkFn(value) ? alertRadius : normalRadius);
}

function chartPointHoverRadius(values) {
  return values.length > 140 ? 4 : 5;
}

function chartPointBorderWidth(values) {
  return values.length > 140 ? 0 : 1;
}

async function loadThresholds() {
  try {
    const response = await apiFetch(`${API_BASE_URL}/thresholds`);
    if (!response.ok) throw new Error(`Threshold API returned HTTP ${response.status}`);

    const data = await response.json();

    LIMITS = {
      minTemperature: Number(data.minTemperature),
      maxTemperature: Number(data.maxTemperature),
      minHumidity: Number(data.minHumidity),
      maxHumidity: Number(data.maxHumidity),
      measurementNotificationsEnabled: data.measurementNotificationsEnabled !== false,
      surveillanceNotificationsEnabled: data.surveillanceNotificationsEnabled !== false,
      deviceNotificationsEnabled: data.deviceNotificationsEnabled !== false
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
  setRangePair("temp", LIMITS.minTemperature, LIMITS.maxTemperature);
  setRangePair("humidity", LIMITS.minHumidity, LIMITS.maxHumidity);
  renderDateRangeSlider();
  renderNotificationToggles();
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) {
    node.classList.remove("loading-inline");
    node.textContent = value;
  }
}

function setRangePair(type, minValue, maxValue) {
  const isHumidity = type === "humidity";
  const maxScale = isHumidity ? 60 : 40;
  const minSlider = document.getElementById(isHumidity ? "minHumiditySlider" : "minTempSlider");
  const maxSlider = document.getElementById(isHumidity ? "maxHumiditySlider" : "maxTempSlider");
  if (!minSlider || !maxSlider) return;

  const min = clampNumber(minValue, 0, maxScale);
  const max = clampNumber(maxValue, min, maxScale);

  minSlider.value = min;
  maxSlider.value = max;
  updateRangePair(type);
}

function updateRangePair(type) {
  const isHumidity = type === "humidity";
  const maxScale = isHumidity ? 60 : 40;
  const minSlider = document.getElementById(isHumidity ? "minHumiditySlider" : "minTempSlider");
  const maxSlider = document.getElementById(isHumidity ? "maxHumiditySlider" : "maxTempSlider");
  const fill = document.getElementById(isHumidity ? "humiditySliderFill" : "tempSliderFill");
  const minHandle = document.getElementById(isHumidity ? "minHumidityHandle" : "minTempHandle");
  const maxHandle = document.getElementById(isHumidity ? "maxHumidityHandle" : "maxTempHandle");
  if (!minSlider || !maxSlider || !fill || !minHandle || !maxHandle) return;

  let min = clampNumber(minSlider.value, 0, maxScale);
  let max = clampNumber(maxSlider.value, 0, maxScale);
  if (min > max) {
    if (document.activeElement === minSlider) {
      max = min;
      maxSlider.value = max;
    } else {
      min = max;
      minSlider.value = min;
    }
  }

  const minPercent = (min / maxScale) * 100;
  const maxPercent = (max / maxScale) * 100;
  const fillPercent = maxPercent - minPercent;
  fill.style.left = `${minPercent}%`;
  fill.style.width = `${fillPercent}%`;
  minHandle.style.left = `${minPercent}%`;
  maxHandle.style.left = `${maxPercent}%`;

  if (isHumidity) {
    document.getElementById("minHumidityInput").value = min;
    document.getElementById("maxHumidityInput").value = max;
    setText("humidityRangeLabel", `${min} - ${max} %`);
  } else {
    document.getElementById("minTempInput").value = min;
    document.getElementById("maxTempInput").value = max;
    setText("tempRangeLabel", `${min} - ${max} °C`);
  }
}

function getSelectedRangeIndex() {
  const selectedHours = getSelectedHoursForApi();
  return Math.max(0, RANGE_PRESETS.findIndex(preset => preset.value === selectedHours));
}

function renderDateRangeSlider() {
  const slider = document.getElementById("rangePresetSlider");
  const fill = document.getElementById("rangePresetFill");
  const handle = document.getElementById("rangePresetHandle");
  if (!slider || !fill || !handle) return;

  const index = getSelectedRangeIndex();
  const preset = RANGE_PRESETS[index] || RANGE_PRESETS[1];
  const percent = (index / (RANGE_PRESETS.length - 1)) * 100;
  slider.value = index;
  fill.style.width = `${percent}%`;
  handle.style.left = `${percent}%`;
  setText("dateRangeLabel", preset.label);
}

function applyRangePresetFromSlider() {
  const slider = document.getElementById("rangePresetSlider");
  const select = document.getElementById("rangeModeSelect");
  if (!slider || !select) return;

  const index = clampNumber(slider.value, 0, RANGE_PRESETS.length - 1);
  const preset = RANGE_PRESETS[index] || RANGE_PRESETS[1];
  select.value = preset.value;
  renderDateRangeSlider();
}

function thresholdSliderParts(type) {
  const isHumidity = type === "humidity";
  return {
    container: document.getElementById(isHumidity ? "humiditySlider" : "tempSlider"),
    minSlider: document.getElementById(isHumidity ? "minHumiditySlider" : "minTempSlider"),
    maxSlider: document.getElementById(isHumidity ? "maxHumiditySlider" : "maxTempSlider"),
    maxScale: isHumidity ? 60 : 40
  };
}

function sliderValueFromPointer(container, maxScale, clientX) {
  const track = container.querySelector(".slider-track")?.getBoundingClientRect();
  if (!track || track.width <= 0) return 0;

  const ratio = (clientX - track.left) / track.width;
  return clampNumber(Math.round(ratio * maxScale), 0, maxScale);
}

function pickThresholdHandle(type, value) {
  const { minSlider, maxSlider } = thresholdSliderParts(type);
  if (!minSlider || !maxSlider) return "max";

  const min = Number(minSlider.value);
  const max = Number(maxSlider.value);
  if (value <= min) return "min";
  if (value >= max) return "max";
  return Math.abs(value - min) <= Math.abs(value - max) ? "min" : "max";
}

function setThresholdHandleFromPointer(type, handle, clientX) {
  const { container, minSlider, maxSlider, maxScale } = thresholdSliderParts(type);
  if (!container || !minSlider || !maxSlider) return;

  const min = Number(minSlider.value);
  const max = Number(maxSlider.value);
  const value = sliderValueFromPointer(container, maxScale, clientX);

  if (handle === "min") {
    minSlider.value = Math.min(value, max);
  } else {
    maxSlider.value = Math.max(value, min);
  }

  updateRangePair(type);
}

function bindThresholdSliderPointer(type) {
  const { container } = thresholdSliderParts(type);
  if (!container) return;

  let drag = null;

  container.addEventListener("pointerdown", event => {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();

    const { maxScale } = thresholdSliderParts(type);
    const value = sliderValueFromPointer(container, maxScale, event.clientX);
    drag = {
      pointerId: event.pointerId,
      handle: pickThresholdHandle(type, value)
    };

    container.setPointerCapture?.(event.pointerId);
    setThresholdHandleFromPointer(type, drag.handle, event.clientX);
  });

  container.addEventListener("pointermove", event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    setThresholdHandleFromPointer(type, drag.handle, event.clientX);
  });

  const endDrag = event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    container.releasePointerCapture?.(event.pointerId);
    drag = null;
    saveThresholds(false);
  };

  container.addEventListener("pointerup", endDrag);
  container.addEventListener("pointercancel", event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    container.releasePointerCapture?.(event.pointerId);
    drag = null;
  });
}

function getLimitsFromInputs() {
  return {
    minTemperature: Number(document.getElementById("minTempInput").value),
    maxTemperature: Number(document.getElementById("maxTempInput").value),
    minHumidity: Number(document.getElementById("minHumidityInput").value),
    maxHumidity: Number(document.getElementById("maxHumidityInput").value),
    measurementNotificationsEnabled: LIMITS.measurementNotificationsEnabled !== false,
    surveillanceNotificationsEnabled: LIMITS.surveillanceNotificationsEnabled !== false,
    deviceNotificationsEnabled: LIMITS.deviceNotificationsEnabled !== false
  };
}

function validateLimits(newLimits) {
  if (
    !Number.isFinite(newLimits.minTemperature) ||
    !Number.isFinite(newLimits.maxTemperature) ||
    !Number.isFinite(newLimits.minHumidity) ||
    !Number.isFinite(newLimits.maxHumidity)
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

function setNotificationToggle(button, enabled) {
  if (!button) return;
  button.classList.toggle("on", enabled);
  button.setAttribute("aria-pressed", String(enabled));
  const label = button.id === "surveillanceNotificationsToggle"
    ? "Surveillance"
    : button.id === "deviceNotificationsToggle"
      ? "Device"
      : "Measurements";
  button.setAttribute("aria-label", `${label} notifications ${enabled ? "on" : "off"}`);
}

function renderNotificationToggles() {
  setNotificationToggle(document.getElementById("surveillanceNotificationsToggle"), LIMITS.surveillanceNotificationsEnabled !== false);
  setNotificationToggle(document.getElementById("measurementNotificationsToggle"), LIMITS.measurementNotificationsEnabled !== false);
  setNotificationToggle(document.getElementById("deviceNotificationsToggle"), LIMITS.deviceNotificationsEnabled !== false);
}

async function saveThresholds() {
  const newLimits = getLimitsFromInputs();
  if (!validateLimits(newLimits)) return;

  try {
    document.querySelectorAll(".threshold-slider, .notification-toggle").forEach(input => {
      input.disabled = true;
    });

    const response = await apiFetch(`${API_BASE_URL}/thresholds`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newLimits)
    });

    if (!response.ok) throw new Error(`Threshold API returned HTTP ${response.status}`);

    const saved = await response.json();

    LIMITS = {
      minTemperature: Number(saved.minTemperature),
      maxTemperature: Number(saved.maxTemperature),
      minHumidity: Number(saved.minHumidity),
      maxHumidity: Number(saved.maxHumidity),
      measurementNotificationsEnabled: saved.measurementNotificationsEnabled !== false,
      surveillanceNotificationsEnabled: saved.surveillanceNotificationsEnabled !== false,
      deviceNotificationsEnabled: saved.deviceNotificationsEnabled !== false
    };

    setError("");
    renderThresholdInputs();
    await loadData();
  } catch (error) {
    console.error(error);
    setError(`Could not save thresholds: ${error.message}`);
  } finally {
    document.querySelectorAll(".threshold-slider, .notification-toggle").forEach(input => {
      input.disabled = false;
    });
  }
}

function setNotificationPreference(key, enabled) {
  LIMITS = {
    ...LIMITS,
    [key]: enabled
  };
  renderNotificationToggles();
  saveThresholds(false);
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

function formatDeviceUpdateTime(value) {
  return new Date(value).toLocaleString("de-CH", {
    day: "2-digit",
    month: "2-digit",
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
    if (statusText) statusText.textContent = `Offline or API error · ${message}`;
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
        pointHoverRadius: chartPointHoverRadius(temperatures),
        pointBorderWidth: chartPointBorderWidth(temperatures),
        pointHitRadius: 8,
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
        pointHoverRadius: chartPointHoverRadius(humidities),
        pointBorderWidth: chartPointBorderWidth(humidities),
        pointHitRadius: 8,
        tension: 0.38,
        fill: true
      }]
    },
    options: chartOptions
  });
}

function renderTable(items) {
  const tbody = document.getElementById("readingsTable");
  if (!tbody) return;

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
  return document.getElementById("rangeModeSelect")?.value || "24";
}

function filterItemsBySelectedRange(items) {
  return items;
}

function getSelectedRangeLabel() {
  const selected = document.getElementById("rangeModeSelect");
  if (!selected) return "Last 24h";
  return selected.options[selected.selectedIndex].text;
}

function handleRangeModeChange() {
  renderDateRangeSlider();
  loadData({ silent: false });
}

async function loadData(options = {}) {
  const hours = getSelectedHoursForApi();
  const url = `${API_BASE_URL}/measurements?deviceId=${encodeURIComponent(DEVICE_ID)}&hours=${hours}`;

  if (!options.silent) {
    document.getElementById("statusText")?.replaceChildren(document.createTextNode("Loading data…"));
    document.getElementById("statusDot")?.classList.remove("online", "alert");
  }

  try {
    const response = await apiFetch(url);
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

    currentTemp.classList.remove("loading-inline");
    currentTemp.textContent = Number(latest.temperature).toFixed(1);
    currentTemp.className = thresholdClass(latestTempAlert);

    currentHumidity.classList.remove("loading-inline");
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

    const statusDot = document.getElementById("statusDot");
    const statusText = document.getElementById("statusText");
    statusDot?.classList.remove("online", "alert");
    if (latestAlert) {
      if (statusText) statusText.textContent = "Online · Current value threshold alert";
      statusDot?.classList.add("alert");
    } else {
      if (statusText) statusText.textContent = "Online · API reachable";
      statusDot?.classList.add("online");
    }

    const lastUpdated = document.getElementById("lastUpdated");
    if (lastUpdated) lastUpdated.textContent = `Last updated: ${new Date().toLocaleTimeString()} · Range: ${getSelectedRangeLabel()}`;

    renderCharts(labels, temperatures, humidities);
    renderTable(items);
    setError("");
  } catch (error) {
    console.error(error);
    const statusText = document.getElementById("statusText");
    if (statusText) statusText.textContent = "Offline or API error";
    setError(error.message);
    renderBatteryStatus("ht3", null);
    renderPowerStatus("ht3", null);
    latestHt3Update = null;
    renderDeviceStatusMeta();
  }
}

async function loadVideos(options = {}) {
  const url = `${API_BASE_URL}/videos`;
  if (!options.silent) {
    const videoStatus = document.getElementById("videoStatus");
    if (videoStatus) videoStatus.textContent = "Videos: loading…";
  }

  try {
    const response = await apiFetch(url);
    if (!response.ok) throw new Error(`Video API returned HTTP ${response.status}`);

    const data = await response.json();
    videos = data.items || [];

    const videoStatus = document.getElementById("videoStatus");
    if (videoStatus) videoStatus.textContent = `Videos: ${videos.length} available`;
  } catch (error) {
    console.error(error);
    const videoStatus = document.getElementById("videoStatus");
    if (videoStatus) videoStatus.textContent = "Videos: API error";
  }
}

async function loadEvents() {
  const url = `${API_BASE_URL}/events`;

  try {
    const response = await apiFetch(url);
    if (!response.ok) throw new Error(`Events API returned HTTP ${response.status}`);

    const data = await response.json();
    events = (data.items || []).filter(item => item.bucketMs === 10000);
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

  groups.forEach(group => {
    eventDayOpenState[group.dayKey] = true;
  });
}

function toggleEventDay(dayKey) {
  const isOpen = eventDayOpenState[dayKey] === true;
  eventDayOpenState[dayKey] = !isOpen;

  document.querySelectorAll(`.event-day-toggle[data-day-key="${dayKey}"]`).forEach(button => {
    button.setAttribute("aria-expanded", String(!isOpen));
    const chevron = button.querySelector(".event-day-chevron");
    if (chevron) chevron.textContent = isOpen ? "+" : "−";
  });

  document.querySelectorAll(`.event-video-row[data-day-key="${dayKey}"]`).forEach(row => {
    row.classList.toggle("event-day-collapsed", isOpen);
  });
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
  if (!tbody) return;

  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="4">No detected events found.</td></tr>`;
    return;
  }

  const groups = getEventGroups(items);
  setDefaultOpenEventDay(groups);
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
          <div class="event-cell-content"><span class="event-time">${formatEventClock(group.date)}</span></div>
        </td>
        <td data-label="Detected">
          <div class="event-cell-content">
            <div class="event-summary">
              <div class="event-title-row">
                <div class="event-title">${title}</div>
              </div>
              <div class="event-tags">${labelChips}</div>
            </div>
          </div>
        </td>
        <td data-label="Confidence"><div class="event-cell-content"><span class="event-confidence">${bestConfidence.toFixed(1)} %</span></div></td>
        <td data-label="Play">
          <div class="event-cell-content"><button data-event-index="${originalIndex}" class="play-event-button">Play</button></div>
        </td>
      </tr>
    `;
  }).join("");

  tbody.innerHTML = rows;

  tbody.querySelectorAll(".event-day-toggle").forEach(button => {
    button.addEventListener("click", () => {
      toggleEventDay(button.dataset.dayKey);
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
  const sectionCard = header.closest(".section-card");

  content.style.overflow = "hidden";

  if (isOpen) {
    content.style.height = `${content.scrollHeight}px`;
    content.offsetHeight;
    content.classList.add("collapsed");
    content.style.height = "0px";
    sectionCard?.classList.add("section-collapsed");
  } else {
    content.classList.remove("collapsed");
    content.style.height = "0px";
    content.offsetHeight;
    content.style.height = `${content.scrollHeight}px`;
    sectionCard?.classList.remove("section-collapsed");
  }

  if (controls) controls.hidden = isOpen;
  header.setAttribute("aria-expanded", String(!isOpen));
  toggle.textContent = isOpen ? "+" : "−";

  content.addEventListener("transitionend", event => {
    if (event.propertyName !== "height") return;
    if (!content.classList.contains("collapsed")) {
      content.style.height = "auto";
      content.style.overflow = "";
    }
  }, { once: true });
}

function bindToggleHeader(header, handler) {
  if (!header) return;
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
  bindThresholdSliderPointer("humidity");
  bindThresholdSliderPointer("temp");
  document.getElementById("rangeModeSelect").addEventListener("change", handleRangeModeChange);
  document.querySelector(".control-console")?.addEventListener("click", event => event.stopPropagation());
  document.querySelector(".control-console")?.addEventListener("keydown", event => event.stopPropagation());
  document.querySelectorAll("[data-threshold-type]").forEach(input => {
    input.addEventListener("input", () => updateRangePair(input.dataset.thresholdType));
    input.addEventListener("change", () => saveThresholds(false));
  });
  document.getElementById("rangePresetSlider")?.addEventListener("input", applyRangePresetFromSlider);
  document.getElementById("rangePresetSlider")?.addEventListener("change", handleRangeModeChange);
  document.getElementById("surveillanceNotificationsToggle")?.addEventListener("click", () => {
    setNotificationPreference("surveillanceNotificationsEnabled", LIMITS.surveillanceNotificationsEnabled === false);
  });
  document.getElementById("measurementNotificationsToggle")?.addEventListener("click", () => {
    setNotificationPreference("measurementNotificationsEnabled", LIMITS.measurementNotificationsEnabled === false);
  });
  document.getElementById("deviceNotificationsToggle")?.addEventListener("click", () => {
    setNotificationPreference("deviceNotificationsEnabled", LIMITS.deviceNotificationsEnabled === false);
  });
  document.getElementById("closeVideoModal").addEventListener("click", closeVideoModal);

  document.getElementById("videoModal").addEventListener("click", event => {
    if (event.target.id === "videoModal") closeVideoModal();
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeVideoModal();
  });
}

async function refreshLiveDashboardData(options = {}) {
  await Promise.allSettled([
    loadFloodState(),
    loadPowerIotState(),
    loadDehumidifierState(),
    loadData({ silent: options.silent !== false })
  ]);
}

async function refreshSurveillanceData(options = {}) {
  await Promise.allSettled([
    loadVideos({ silent: options.silent !== false }),
    loadEvents()
  ]);
}

async function refreshDashboardData(options = {}) {
  await refreshLiveDashboardData(options);
  await Promise.allSettled([
    refreshSurveillanceData(options),
    loadAuditCosts()
  ]);
}

function refreshAuditCostsIfStale() {
  if (Date.now() - lastAuditRefreshAt < AUDIT_REFRESH_MS) return;
  loadAuditCosts();
}

function startDashboardAutoRefresh() {
  setInterval(() => {
    if (!document.hidden) refreshLiveDashboardData({ silent: true });
  }, LIVE_REFRESH_MS);

  setInterval(() => {
    if (!document.hidden) refreshSurveillanceData({ silent: true });
  }, SURVEILLANCE_REFRESH_MS);

  setInterval(() => {
    if (!document.hidden) loadAuditCosts();
  }, AUDIT_REFRESH_MS);

  const refreshOnFocus = () => {
    if (document.hidden) return;
    const now = Date.now();
    if (now - lastFocusRefreshAt < 3_000) return;
    lastFocusRefreshAt = now;
    refreshLiveDashboardData({ silent: true });
    refreshSurveillanceData({ silent: true });
    refreshAuditCostsIfStale();
  };

  document.addEventListener("visibilitychange", refreshOnFocus);
  window.addEventListener("focus", refreshOnFocus);
}

async function init() {
  setupDefaultDateRange();
  registerEventListeners();

  await loadThresholds();
  await refreshDashboardData({ silent: false });
  startDashboardAutoRefresh();
}

if (window.StorageRetschwilAuth) {
  window.StorageRetschwilAuth.bootstrap(init);
} else {
  init();
}
