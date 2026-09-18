import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand
} from "@aws-sdk/lib-dynamodb";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const CONFIG_TABLE = process.env.CONFIG_TABLE || "storageretschwilconfig";
const POWER_STATE_KEY = process.env.POWER_STATE_KEY || "powerIotState";
const POWER_ENERGY_BASELINES_KEY = process.env.POWER_ENERGY_BASELINES_KEY || "powerIotEnergyBaselines";
const POWER_DEVICE_ID = process.env.POWER_DEVICE_ID || "plugsstorageretschwil";
const DEHUMIDIFIER_STATE_KEY = process.env.DEHUMIDIFIER_STATE_KEY || "dehumidifierState";
const DEHUMIDIFIER_DEVICE_ID = process.env.DEHUMIDIFIER_DEVICE_ID || "dehumidifier";
const ENERGY_TARIFF_CHF_PER_KWH = Number(process.env.ENERGY_TARIFF_CHF_PER_KWH || 0.08);
const ENERGY_PERIOD_START_AT = process.env.ENERGY_PERIOD_START_AT || "2026-06-27T10:00:00.000Z";
const SHELLY_CLOUD_SERVER = process.env.SHELLY_CLOUD_SERVER || "";
const SHELLY_CLOUD_AUTH_KEY = process.env.SHELLY_CLOUD_AUTH_KEY || "";
const SHELLY_CLOUD_DEVICE_ID = process.env.SHELLY_CLOUD_DEVICE_ID || "";
const DEHUMIDIFIER_CLOUD_DEVICE_ID = process.env.DEHUMIDIFIER_CLOUD_DEVICE_ID || "e08cfe8c47dc";
const POWER_AUTO_ON_DELAY_SECONDS = Number(process.env.POWER_AUTO_ON_DELAY_SECONDS || 30);
const SHELLY_STATUS_CACHE_SECONDS = Number(process.env.SHELLY_STATUS_CACHE_SECONDS || 15);
const SHELLY_STATUS_LOCK_KEY = process.env.SHELLY_STATUS_LOCK_KEY || "shellyCloudStatusRefreshLock";
const SHELLY_COMMAND_RETRY_DELAYS_MS = [1500, 3000];

const DEVICE_TARGETS = {
  power: {
    aliases: new Set(["", "power", "power-iot", "poweriot", POWER_DEVICE_ID.toLowerCase()]),
    configKey: POWER_STATE_KEY,
    deviceId: POWER_DEVICE_ID,
    cloudDeviceId: SHELLY_CLOUD_DEVICE_ID,
    includeEnergy: true
  },
  dehumidifier: {
    aliases: new Set(["dehumidifier", "uni-plus", "uniplus", "uniplus-power", "power-dehumidifier", DEHUMIDIFIER_DEVICE_ID.toLowerCase()]),
    configKey: DEHUMIDIFIER_STATE_KEY,
    deviceId: DEHUMIDIFIER_DEVICE_ID,
    cloudDeviceId: DEHUMIDIFIER_CLOUD_DEVICE_ID,
    includeEnergy: false,
    controlMode: "toggle"
  }
};

const jsonHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "https://storageretschwil.ortus.one",
  "Access-Control-Allow-Headers": "content-type,authorization",
  "Access-Control-Allow-Methods": "GET,PUT,OPTIONS"
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: jsonHeaders,
    body: JSON.stringify(body)
  };
}

function pick(...values) {
  return values.find(value => value !== undefined && value !== null && value !== "");
}

function boolOrNull(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }
  return null;
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function absoluteNumberOrNull(value) {
  const n = numberOrNull(value);
  return n === null ? null : Math.abs(n);
}

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function isFreshState(state, maxAgeSeconds = SHELLY_STATUS_CACHE_SECONDS) {
  const updatedAt = Date.parse(state?.updatedAt || "");
  return Number.isFinite(updatedAt) && Date.now() - updatedAt < maxAgeSeconds * 1000;
}

function resolveTarget(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return Object.values(DEVICE_TARGETS).find(target => target.aliases.has(normalized)) || DEVICE_TARGETS.power;
}

function parseEventTime(...values) {
  const value = pick(...values);
  const n = Number(value);

  if (Number.isFinite(n) && n > 0) {
    return n > 10_000_000_000 ? Math.floor(n / 1000) : Math.floor(n);
  }

  return Math.floor(Date.now() / 1000);
}

function normalizePowerState(source = {}) {
  const params = source.params || {};
  const status = source.status || params.status || {};
  const switchStatus = status["switch:0"] || params["switch:0"] || source["switch:0"] || {};
  const aenergy = switchStatus.aenergy || {};
  const temperature = switchStatus.temperature || {};
  const devicePower = status["devicepower:0"] || params["devicepower:0"] || {};

  const eventTime = parseEventTime(params.ts, source.ts, source.eventtime, source.eventTime);
  const nowIso = new Date().toISOString();

  return {
    configKey: POWER_STATE_KEY,
    deviceId: String(pick(source.src, params.src, source.deviceId, POWER_DEVICE_ID)),
    output: boolOrNull(pick(switchStatus.output, source.output, source.on)),
    apower: absoluteNumberOrNull(pick(switchStatus.apower, source.apower, source.power)),
    voltage: numberOrNull(pick(switchStatus.voltage, source.voltage)),
    current: absoluteNumberOrNull(pick(switchStatus.current, source.current)),
    energyTotalWh: numberOrNull(pick(aenergy.total, source.energyTotalWh)),
    temperature: numberOrNull(pick(temperature.tC, switchStatus.temperature?.value, source.temperature)),
    externalPowerPresent: boolOrNull(pick(devicePower.external?.present, source.externalPowerPresent)),
    method: source.method || "unknown",
    eventTime,
    updatedAt: nowIso
  };
}

function normalizeCloudStatus(device = {}, target = DEVICE_TARGETS.power) {
  const deviceStatus = device.status || device.device_status || device;
  const switchStatus = deviceStatus["switch:0"] || {};
  const aenergy = switchStatus.aenergy || {};
  const temperature = switchStatus.temperature || {};
  const switchSettings = device.settings?.["switch:0"] || {};
  const nowIso = new Date().toISOString();
  const timerStartedAt = numberOrNull(switchStatus.timer_started_at);
  const timerDuration = numberOrNull(switchStatus.timer_duration);
  const autoOnAt = switchStatus.output === false && timerStartedAt !== null && timerDuration !== null
    ? new Date((timerStartedAt + timerDuration) * 1000).toISOString()
    : null;

  return {
    configKey: target.configKey,
    deviceId: target.deviceId,
    cloudDeviceId: target.cloudDeviceId || null,
    output: boolOrNull(switchStatus.output),
    apower: absoluteNumberOrNull(switchStatus.apower),
    voltage: numberOrNull(switchStatus.voltage),
    current: absoluteNumberOrNull(switchStatus.current),
    frequency: numberOrNull(switchStatus.freq),
    energyTotalWh: numberOrNull(aenergy.total),
    returnedEnergyTotalWh: numberOrNull(switchStatus.ret_aenergy?.total),
    temperature: numberOrNull(temperature.tC),
    cloudConnected: boolOrNull(pick(device.online, deviceStatus.cloud?.connected)),
    wifiRssi: numberOrNull(deviceStatus.wifi?.rssi),
    autoOnConfigured: boolOrNull(switchSettings.auto_on),
    autoOnDelaySeconds: numberOrNull(switchSettings.auto_on_delay),
    autoOnAt,
    method: "ShellyCloudStatus",
    eventTime: Math.floor(Date.now() / 1000),
    updatedAt: nowIso
  };
}

function todayKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function zurichYear(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Zurich",
    year: "numeric"
  }).format(date);
}

function monthKey() {
  return todayKey().slice(0, 7);
}

function daysInZurichMonth(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
}

function dayOfMonthZurich(day) {
  return Number(day.slice(-2));
}

function round(value, decimals = 3) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

async function enrichEnergyMetrics(state) {
  const totalWh = Number(state.energyTotalWh);
  if (!Number.isFinite(totalWh)) {
    return {
      ...state,
      tariffChfPerKwh: ENERGY_TARIFF_CHF_PER_KWH
    };
  }

  const day = todayKey();
  const month = monthKey();
  const result = await ddb.send(new GetCommand({
    TableName: CONFIG_TABLE,
    Key: { configKey: POWER_ENERGY_BASELINES_KEY }
  }));

  const existing = result.Item || {};
  const currentYear = zurichYear();
  const configuredStartYear = zurichYear(new Date(ENERGY_PERIOD_START_AT));
  const periodBaselineWh = Number.isFinite(Number(existing.periodBaselineWh)) && existing.periodStartAt === ENERGY_PERIOD_START_AT
    ? Number(existing.periodBaselineWh)
    : totalWh;
  const dayBaselineWh = existing.day === day && Number.isFinite(Number(existing.dayBaselineWh))
    ? Number(existing.dayBaselineWh)
    : totalWh;
  const monthBaselineWh = existing.month === month && Number.isFinite(Number(existing.monthBaselineWh))
    ? Number(existing.monthBaselineWh)
    : totalWh;
  const yearBaselines = {
    ...(existing.yearBaselines || {})
  };

  if (!Number.isFinite(Number(yearBaselines[currentYear]))) {
    yearBaselines[currentYear] = currentYear === configuredStartYear ? periodBaselineWh : totalWh;
  }

  await ddb.send(new PutCommand({
    TableName: CONFIG_TABLE,
    Item: {
      configKey: POWER_ENERGY_BASELINES_KEY,
      day,
      dayBaselineWh,
      month,
      monthBaselineWh,
      periodStartAt: ENERGY_PERIOD_START_AT,
      periodBaselineWh,
      yearBaselines,
      updatedAt: new Date().toISOString()
    }
  }));

  const todayKwh = Math.max(0, (totalWh - dayBaselineWh) / 1000);
  const monthKwh = Math.max(0, (totalWh - monthBaselineWh) / 1000);
  const totalSinceStartKwh = Math.max(0, (totalWh - periodBaselineWh) / 1000);
  const elapsedDays = Math.max(1, dayOfMonthZurich(day));
  const monthEstimateKwh = monthKwh > 0 ? monthKwh / elapsedDays * daysInZurichMonth(month) : 0;
  const annualCosts = Object.entries(yearBaselines)
    .filter(([year]) => Number(year) <= Number(currentYear))
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([year, baselineWh]) => {
      const isCurrentYear = year === currentYear;
      const kwh = isCurrentYear ? Math.max(0, (totalWh - Number(baselineWh)) / 1000) : Number(existing.yearTotals?.[year]?.kwh || 0);

      return {
        year,
        kwh: round(kwh, 3),
        costChf: round(kwh * ENERGY_TARIFF_CHF_PER_KWH, 2),
        current: isCurrentYear
      };
    });

  return {
    ...state,
    tariffChfPerKwh: ENERGY_TARIFF_CHF_PER_KWH,
    totalKwh: round(totalWh / 1000, 3),
    totalSinceStartKwh: round(totalSinceStartKwh, 3),
    totalSinceStartCostChf: round(totalSinceStartKwh * ENERGY_TARIFF_CHF_PER_KWH, 2),
    energyPeriodStartAt: ENERGY_PERIOD_START_AT,
    todayKwh: round(todayKwh, 3),
    monthKwh: round(monthKwh, 3),
    todayCostChf: round(todayKwh * ENERGY_TARIFF_CHF_PER_KWH, 2),
    monthCostChf: round(monthKwh * ENERGY_TARIFF_CHF_PER_KWH, 2),
    monthEstimateKwh: round(monthEstimateKwh, 3),
    monthEstimateChf: round(monthEstimateKwh * ENERGY_TARIFF_CHF_PER_KWH, 2),
    annualCosts
  };
}

function hasShellyCloudConfig(target = DEVICE_TARGETS.power) {
  return Boolean(SHELLY_CLOUD_SERVER && SHELLY_CLOUD_AUTH_KEY && target.cloudDeviceId);
}

async function shellyCloudV2Request(path, body, options = {}) {
  if (!SHELLY_CLOUD_SERVER || !SHELLY_CLOUD_AUTH_KEY) {
    throw new Error("Shelly Cloud is not configured.");
  }

  const retryDelays = options.retryRateLimit ? SHELLY_COMMAND_RETRY_DELAYS_MS : [];

  for (let attempt = 0; ; attempt += 1) {
    const url = new URL(`${SHELLY_CLOUD_SERVER.replace(/\/$/, "")}${path}`);
    url.searchParams.set("auth_key", SHELLY_CLOUD_AUTH_KEY);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    const payload = await response.json().catch(() => ({}));
    if (response.ok && payload.isok !== false) return payload;

    const errors = Array.isArray(payload.errors) ? payload.errors.join(", ") : payload.errors;
    const message = errors || payload.error || payload.message || `Shelly Cloud HTTP ${response.status}`;
    const rateLimited = response.status === 429 || /TOO_MANY_REQUESTS/i.test(String(message));
    if (!rateLimited || attempt >= retryDelays.length) {
      const error = new Error(message);
      error.statusCode = response.status;
      throw error;
    }

    const retryAfterSeconds = Number(response.headers.get("retry-after"));
    const delay = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? retryAfterSeconds * 1000
      : retryDelays[attempt];
    console.warn(`Shelly Cloud rate limited ${path}; retrying in ${delay} ms.`);
    await sleep(delay);
  }
}

function shellyDevicesFromPayload(payload = {}) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.devices)) return payload.devices;
  if (Array.isArray(payload.data?.devices)) return payload.data.devices;
  return [];
}

async function getShellyCloudStates(targets = Object.values(DEVICE_TARGETS)) {
  const configuredTargets = targets.filter(target => hasShellyCloudConfig(target));
  const payload = await shellyCloudV2Request("/v2/devices/api/get", {
    ids: configuredTargets.map(target => target.cloudDeviceId),
    select: ["status", "settings"]
  });
  const devices = shellyDevicesFromPayload(payload);
  const states = {};

  for (const target of configuredTargets) {
    const device = devices.find(item => String(item.id || item.device_id) === String(target.cloudDeviceId));
    if (!device) throw new Error(`Shelly Cloud returned no state for ${target.deviceId}.`);

    const normalized = normalizeCloudStatus(device, target);
    const previous = await getStoredPowerState(target);
    const state = target.includeEnergy ? await enrichEnergyMetrics(normalized) : {
      ...normalized,
      automationActive: previous.automationActive ?? false,
      automationActiveSince: previous.automationActiveSince ?? null,
      automationSource: previous.automationSource ?? null
    };
    await putPowerState(state);
    states[target === DEVICE_TARGETS.power ? "power" : "dehumidifier"] = {
      ...state,
      status: state.output === true ? "on" : state.output === false ? "off" : "unknown"
    };
  }

  return states;
}

async function setShellyCloudOutput(on, target = DEVICE_TARGETS.power) {
  const command = {
    id: target.cloudDeviceId,
    channel: 0,
    on: target.controlMode === "toggle" ? true : on
  };

  if (target === DEVICE_TARGETS.power && on === false) {
    command.toggle_after = POWER_AUTO_ON_DELAY_SECONDS;
  }

  await shellyCloudV2Request("/v2/devices/api/set/switch", command, { retryRateLimit: true });
}

async function acquireStatusRefreshLock() {
  const ownerToken = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const now = Date.now();

  try {
    await ddb.send(new PutCommand({
      TableName: CONFIG_TABLE,
      Item: {
        configKey: SHELLY_STATUS_LOCK_KEY,
        ownerToken,
        lockUntilEpochMs: now + 10_000,
        updatedAt: new Date(now).toISOString()
      },
      ConditionExpression: "attribute_not_exists(configKey) OR lockUntilEpochMs < :now",
      ExpressionAttributeValues: { ":now": now }
    }));
    return ownerToken;
  } catch (error) {
    if (error.name === "ConditionalCheckFailedException") return null;
    throw error;
  }
}

async function releaseStatusRefreshLock(ownerToken) {
  if (!ownerToken) return;
  try {
    await ddb.send(new DeleteCommand({
      TableName: CONFIG_TABLE,
      Key: { configKey: SHELLY_STATUS_LOCK_KEY },
      ConditionExpression: "ownerToken = :ownerToken",
      ExpressionAttributeValues: { ":ownerToken": ownerToken }
    }));
  } catch (error) {
    if (error.name !== "ConditionalCheckFailedException") {
      console.warn("Could not release Shelly status refresh lock:", error.message);
    }
  }
}

async function getPowerState(target = DEVICE_TARGETS.power) {
  const stored = await getStoredPowerState(target);
  if (isFreshState(stored)) return stored;

  if (hasShellyCloudConfig(target)) {
    const ownerToken = await acquireStatusRefreshLock();
    if (!ownerToken) return stored;
    try {
      const key = target === DEVICE_TARGETS.power ? "power" : "dehumidifier";
      return (await getShellyCloudStates([target]))[key];
    } catch (error) {
      console.warn("Shelly Cloud status failed, falling back to DynamoDB:", error.message);
    } finally {
      await releaseStatusRefreshLock(ownerToken);
    }
  }

  return stored;
}

async function getAllPowerStates() {
  const [storedPower, storedDehumidifier] = await Promise.all([
    getStoredPowerState(DEVICE_TARGETS.power),
    getStoredPowerState(DEVICE_TARGETS.dehumidifier)
  ]);
  if (isFreshState(storedPower) && isFreshState(storedDehumidifier)) {
    return { power: storedPower, dehumidifier: storedDehumidifier };
  }

  const ownerToken = await acquireStatusRefreshLock();
  if (!ownerToken) return { power: storedPower, dehumidifier: storedDehumidifier };
  try {
    const states = await getShellyCloudStates();
    return {
      power: states.power || storedPower,
      dehumidifier: states.dehumidifier || storedDehumidifier
    };
  } catch (error) {
    console.warn("Shelly Cloud batch status failed, falling back to DynamoDB:", error.message);
    return {
      power: storedPower,
      dehumidifier: storedDehumidifier
    };
  } finally {
    await releaseStatusRefreshLock(ownerToken);
  }
}

async function getStoredPowerState(target = DEVICE_TARGETS.power) {
  const result = await ddb.send(new GetCommand({
    TableName: CONFIG_TABLE,
    Key: { configKey: target.configKey }
  }));

  if (!result.Item) {
    return {
      configKey: target.configKey,
      deviceId: target.deviceId,
      cloudDeviceId: target.cloudDeviceId || null,
      output: null,
      status: "unknown",
      apower: null,
      voltage: null,
      current: null,
      energyTotalWh: null,
      temperature: null,
      updatedAt: null,
      eventTime: null
    };
  }

  return {
    ...result.Item,
    status: result.Item.output === true ? "on" : result.Item.output === false ? "off" : "unknown"
  };
}

async function putPowerState(state) {
  await ddb.send(new PutCommand({
    TableName: CONFIG_TABLE,
    Item: state
  }));
}

async function handleIotEvent(event) {
  const state = normalizePowerState(event);

  if (state.deviceId !== POWER_DEVICE_ID && event.src !== POWER_DEVICE_ID) {
    return { ignored: true, reason: "different device", deviceId: state.deviceId };
  }

  await putPowerState(state);
  return { ok: true, deviceId: state.deviceId, output: state.output };
}

async function publishSwitchCommand(on, target = DEVICE_TARGETS.power, options = {}) {
  let cloudCommandSent = false;

  if (hasShellyCloudConfig(target)) {
    await setShellyCloudOutput(on, target);
    cloudCommandSent = true;
  }

  const currentState = await getStoredPowerState(target);
  const output = target.controlMode === "toggle" ? currentState.output : on;
  const automationActive = target === DEVICE_TARGETS.dehumidifier && options.automation === true && on === true;
  const automationActiveSince = automationActive
    ? (currentState.automationActiveSince || new Date().toISOString())
    : null;
  const optimistic = {
    ...currentState,
    configKey: target.configKey,
    deviceId: target.deviceId,
    cloudDeviceId: target.cloudDeviceId || null,
    output,
    status: output === true ? "on" : output === false ? "off" : "unknown",
    cloudCommandSent,
    commandMode: target.controlMode || "set",
    commandTarget: on ? "on" : "off",
    automationActive,
    automationActiveSince,
    automationSource: automationActive ? "humidity" : null,
    autoOnAt: target === DEVICE_TARGETS.power && on === false
      ? new Date(Date.now() + POWER_AUTO_ON_DELAY_SECONDS * 1000).toISOString()
      : null,
    autoOnDelaySeconds: target === DEVICE_TARGETS.power ? POWER_AUTO_ON_DELAY_SECONDS : null,
    lastCommandAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  await putPowerState(optimistic);

  return optimistic;
}

async function parseApiBody(event) {
  if (!event.body) return {};
  const text = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
  return JSON.parse(text);
}

async function handleApi(event) {
  const method = event.requestContext?.http?.method || event.httpMethod;
  const query = event.queryStringParameters || {};

  if (method === "OPTIONS") return { statusCode: 204, headers: jsonHeaders };
  if (method === "GET") {
    const requestedDevice = String(query.device || query.deviceId || "").trim().toLowerCase();
    if (requestedDevice === "all") return json(200, await getAllPowerStates());
    return json(200, await getPowerState(resolveTarget(requestedDevice)));
  }

  if (method === "PUT") {
    const body = await parseApiBody(event);
    const target = resolveTarget(body.device || body.deviceId || query.device || query.deviceId);
    const on = boolOrNull(pick(body.on, body.output, body.status));
    if (on === null) return json(400, { message: "Body must include boolean on/output/status." });

    return json(202, await publishSwitchCommand(on, target, {
      automation: body.automation === true
    }));
  }

  return json(405, { message: "Method not allowed." });
}

export const handler = async (event) => {
  console.log("Incoming event:", JSON.stringify(event));

  try {
    if (event.requestContext?.http || event.httpMethod) {
      return await handleApi(event);
    }

    return await handleIotEvent(event);
  } catch (error) {
    console.error(error);
    return json(500, { message: error.message || "Power IoT backend error." });
  }
};
