import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand
} from "@aws-sdk/lib-dynamodb";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { createHash, createSign } from "node:crypto";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const lambda = new LambdaClient({});
const secretsManager = new SecretsManagerClient({});

const CONFIG_TABLE = "storageretschwilconfig";
const THRESHOLD_KEY = "thresholds";
const FLOOD_STATE_KEY = "floorFloodState";
const DEVICE_NOTIFICATION_STATE_KEY = "deviceNotificationAlertState";
const MEASUREMENT_NOTIFICATION_STATE_KEY = "measurementNotificationAlertState";
const PUSH_TOKENS_KEY = "androidPushTokens";
const FIREBASE_SECRET_ID = process.env.FIREBASE_SECRET_ID || "storageretschwil/firebase-service-account";
const POWER_IOT_FUNCTION_NAME = process.env.POWER_IOT_FUNCTION_NAME || "storageretschwilPowerIoT";
const DEHUMIDIFIER_ON_WATTS = Number(process.env.DEHUMIDIFIER_ON_WATTS || 200);
const DEHUMIDIFIER_OFF_WATTS = Number(process.env.DEHUMIDIFIER_OFF_WATTS || 100);

let firebaseCredentialCache = null;
let firebaseAccessTokenCache = null;

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function alertSignature(payload) {
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

async function getNotificationSignature(configKey) {
  const result = await ddb.send(new GetCommand({
    TableName: CONFIG_TABLE,
    Key: { configKey }
  }));

  return result.Item?.signature || null;
}

async function putNotificationSignature(configKey, signature, payload) {
  await ddb.send(new PutCommand({
    TableName: CONFIG_TABLE,
    Item: {
      configKey,
      signature,
      payload,
      updatedAt: new Date().toISOString()
    }
  }));
}

async function getThresholds() {
  const result = await ddb.send(new GetCommand({
    TableName: CONFIG_TABLE,
    Key: { configKey: THRESHOLD_KEY }
  }));

  if (!result.Item) {
    throw new Error("Thresholds not found");
  }

  const thresholds = {
    minTemperature: Number(result.Item.minTemperature),
    maxTemperature: Number(result.Item.maxTemperature),
    minHumidity: Number(result.Item.minHumidity),
    maxHumidity: Number(result.Item.maxHumidity),
    measurementNotificationsEnabled: result.Item.measurementNotificationsEnabled !== false,
    deviceNotificationsEnabled: result.Item.deviceNotificationsEnabled !== false
  };

  console.log("Loaded thresholds:", JSON.stringify(thresholds));
  return thresholds;
}

function lambdaPayload(method, queryStringParameters = {}, body = null) {
  return {
    requestContext: {
      http: { method }
    },
    queryStringParameters,
    body: body ? JSON.stringify(body) : undefined
  };
}

async function invokePowerIot(payload) {
  const response = await lambda.send(new InvokeCommand({
    FunctionName: POWER_IOT_FUNCTION_NAME,
    Payload: Buffer.from(JSON.stringify(payload))
  }));

  const text = Buffer.from(response.Payload || []).toString("utf8");
  const apiResponse = text ? JSON.parse(text) : {};
  const body = apiResponse.body ? JSON.parse(apiResponse.body) : apiResponse;

  if (apiResponse.statusCode && apiResponse.statusCode >= 400) {
    throw new Error(body.message || body.error || `Power IoT returned HTTP ${apiResponse.statusCode}`);
  }

  return body;
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function boolOrNull(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on", "connected", "present"].includes(normalized)) return true;
    if (["false", "0", "no", "off", "disconnected", "absent", "battery"].includes(normalized)) return false;
  }
  return null;
}

function positivePowerWatts(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.abs(n) : null;
}

function dehumidifierPowerState(powerState = {}) {
  const watts = positivePowerWatts(powerState.apower);
  if (watts === null) return null;
  if (watts > DEHUMIDIFIER_ON_WATTS) return true;
  if (watts < DEHUMIDIFIER_OFF_WATTS) return false;
  return null;
}

async function controlDehumidifierByHumidity(humidity, thresholds) {
  const targetHumidity = Number(thresholds.maxHumidity);
  if (!Number.isFinite(humidity) || !Number.isFinite(targetHumidity)) {
    return { skipped: true, reason: "missing humidity or threshold" };
  }

  const shouldRun = humidity > targetHumidity;
  const powerState = await invokePowerIot(lambdaPayload("GET"));
  const isRunning = dehumidifierPowerState(powerState);

  if (isRunning === shouldRun) {
    return {
      changed: false,
      reason: "already in target state",
      humidity,
      targetHumidity,
      shouldRun,
      plugWatts: positivePowerWatts(powerState.apower)
    };
  }

  if (isRunning === null) {
    return {
      changed: false,
      reason: "plug wattage in transition range",
      humidity,
      targetHumidity,
      shouldRun,
      plugWatts: positivePowerWatts(powerState.apower)
    };
  }

  const command = await invokePowerIot(lambdaPayload(
    "PUT",
    { device: "dehumidifier" },
    { device: "dehumidifier", on: shouldRun, automation: true }
  ));

  return {
    changed: true,
    humidity,
    targetHumidity,
    shouldRun,
    previousPlugWatts: positivePowerWatts(powerState.apower),
    commandStatus: command.status,
    commandMode: command.commandMode
  };
}

function base64Url(value) {
  return Buffer.from(value).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function getFirebaseCredentials() {
  if (firebaseCredentialCache) return firebaseCredentialCache;

  const result = await secretsManager.send(new GetSecretValueCommand({ SecretId: FIREBASE_SECRET_ID }));
  firebaseCredentialCache = JSON.parse(result.SecretString);
  return firebaseCredentialCache;
}

async function getFirebaseAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (firebaseAccessTokenCache && firebaseAccessTokenCache.expiresAt > now + 60) {
    return firebaseAccessTokenCache.token;
  }

  const credentials = await getFirebaseCredentials();
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: credentials.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  };
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claims))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(credentials.private_key, "base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  const assertion = `${unsigned}.${signature}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`Firebase OAuth failed: HTTP ${response.status} - ${JSON.stringify(payload)}`);
  }

  firebaseAccessTokenCache = {
    token: payload.access_token,
    expiresAt: now + Number(payload.expires_in || 3600)
  };
  return firebaseAccessTokenCache.token;
}

async function getPushTokens() {
  const result = await ddb.send(new GetCommand({
    TableName: CONFIG_TABLE,
    Key: { configKey: PUSH_TOKENS_KEY }
  }));

  return Object.values(result.Item?.tokens || {})
    .filter(item => item?.enabled !== false && item?.token);
}

async function sendAndroidPush(title, body, data = {}) {
  const tokens = await getPushTokens();
  if (!tokens.length) {
    console.log("Android push skipped: no registered FCM tokens.");
    return { sent: 0, failed: 0 };
  }

  const credentials = await getFirebaseCredentials();
  const accessToken = await getFirebaseAccessToken();
  const endpoint = `https://fcm.googleapis.com/v1/projects/${credentials.project_id}/messages:send`;
  let sent = 0;
  let failed = 0;

  await Promise.all(tokens.map(async item => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: {
          token: item.token,
          data: {
            ...Object.fromEntries(Object.entries(data).map(([key, value]) => [key, String(value)])),
            title,
            body,
            url: "https://storageretschwil.ortus.one"
          },
          android: {
            priority: "HIGH"
          }
        }
      })
    });

    const text = await response.text();
    if (response.ok) {
      sent += 1;
    } else {
      failed += 1;
      console.error("Android push failed:", response.status, text);
    }
  }));

  return { sent, failed };
}

async function getFloodState() {
  const result = await ddb.send(new GetCommand({
    TableName: CONFIG_TABLE,
    Key: { configKey: FLOOD_STATE_KEY }
  }));

  return result.Item || {};
}

async function getDeviceNotificationState() {
  const result = await ddb.send(new GetCommand({
    TableName: CONFIG_TABLE,
    Key: { configKey: DEVICE_NOTIFICATION_STATE_KEY }
  }));

  return result.Item || {};
}

async function putDeviceNotificationState(state) {
  await ddb.send(new PutCommand({
    TableName: CONFIG_TABLE,
    Item: {
      configKey: DEVICE_NOTIFICATION_STATE_KEY,
      ...state,
      updatedAt: new Date().toISOString()
    }
  }));
}

function deviceAlert(signature, line) {
  return { signature, line };
}

function signaturesChanged(previous = [], current = []) {
  const previousText = [...previous].sort().join("|");
  const currentText = [...current].sort().join("|");
  return previousText !== currentText;
}

async function collectDeviceStatusAlerts(event = {}) {
  const alerts = [];
  const ht3ExternalPower = boolOrNull(
    event.externalPowerPresent ??
    event.external_power_present ??
    event.externalPower ??
    event.powerConnected
  );
  if (ht3ExternalPower === false) {
    alerts.push(deviceAlert("ht3-external-power-not-connected", "🔌 HT3 External Power: Not connected"));
  }

  try {
    const floodState = await getFloodState();
    const floodBattery = numberOrNull(floodState.batteryPercent);
    if (floodBattery !== null && floodBattery < 5) {
      alerts.push(deviceAlert("flood-battery-low", `🔋 Flood Battery: ${floodBattery}%`));
    }

    if (floodState.cableUnplugged === true) {
      alerts.push(deviceAlert("flood-cable-not-connected", "🔌 Flood Cable: Not connected"));
    }
  } catch (error) {
    console.error("Could not evaluate flood device status:", error);
  }

  try {
    const powerState = await invokePowerIot(lambdaPayload("GET"));
    if (powerState.cloudConnected === false) {
      alerts.push(deviceAlert("power-iot-offline", "☁️ Power IoT: Offline"));
    }
  } catch (error) {
    alerts.push(deviceAlert("power-iot-offline", "☁️ Power IoT: Offline"));
    console.error("Could not evaluate Power IoT status:", error);
  }

  try {
    const dehumidifierState = await invokePowerIot(lambdaPayload("GET", { device: "dehumidifier" }));
    if (dehumidifierState.cloudConnected === false) {
      alerts.push(deviceAlert("dehumidifier-offline", "☁️ Dehumidifier: Offline"));
    }
  } catch (error) {
    alerts.push(deviceAlert("dehumidifier-offline", "☁️ Dehumidifier: Offline"));
    console.error("Could not evaluate Dehumidifier status:", error);
  }

  return alerts;
}

async function sendDeviceStatusNotifications(event, thresholds) {
  if (!thresholds.deviceNotificationsEnabled) {
    return { enabled: false, sent: false, alerts: [] };
  }

  const alerts = await collectDeviceStatusAlerts(event);
  const signatures = alerts.map(alert => alert.signature).sort();
  const previous = await getDeviceNotificationState();
  const previousSignatures = Array.isArray(previous.activeSignatures) ? previous.activeSignatures : [];

  if (signatures.length === 0) {
    if (previousSignatures.length > 0) {
      await putDeviceNotificationState({ activeSignatures: [], lastAlerts: [] });
    }
    return { enabled: true, sent: false, alerts: [] };
  }

  if (!signaturesChanged(previousSignatures, signatures)) {
    return { enabled: true, sent: false, alerts: alerts.map(alert => alert.line), reason: "unchanged active device alerts" };
  }

  try {
    await sendAndroidPush(
      "Storage Retschwil Alert",
      alerts.map(alert => alert.line.replace(/^[^\w]+ /u, "")).join("\n"),
      { type: "device" }
    );
  } catch (error) {
    console.error("Android push failed for device alert:", error);
  }
  await putDeviceNotificationState({
    activeSignatures: signatures,
    lastAlerts: alerts.map(alert => alert.line),
    lastSentAt: new Date().toISOString()
  });

  return { enabled: true, sent: true, alerts: alerts.map(alert => alert.line) };
}

export const handler = async (event) => {
  console.log("Incoming event:", JSON.stringify(event));

  const thresholds = await getThresholds();

  const deviceId = event.deviceId || event.src || "unknown-device";
  const eventTime = event.eventtime || event.eventTs || Math.floor(Date.now() / 1000);

  const temperature = Number(event.temperature);
  const humidity = Number(event.humidity);

  console.log("Parsed values:", { deviceId, eventTime, temperature, humidity });

  let dehumidifierAutomation = null;
  try {
    dehumidifierAutomation = await controlDehumidifierByHumidity(humidity, thresholds);
    console.log("Dehumidifier automation:", JSON.stringify(dehumidifierAutomation));
  } catch (error) {
    dehumidifierAutomation = { error: error.message };
    console.error("Dehumidifier automation failed:", error);
  }

  let deviceNotifications = null;
  try {
    deviceNotifications = await sendDeviceStatusNotifications(event, thresholds);
    console.log("Device notifications:", JSON.stringify(deviceNotifications));
  } catch (error) {
    deviceNotifications = { error: error.message };
    console.error("Device notifications failed:", error);
  }

  const alerts = [];

  if (Number.isFinite(temperature)) {
    if (temperature > thresholds.maxTemperature) {
      alerts.push(`Temperature too high: ${temperature} °C > ${thresholds.maxTemperature} °C`);
    }

    if (temperature < thresholds.minTemperature) {
      alerts.push(`Temperature too low: ${temperature} °C < ${thresholds.minTemperature} °C`);
    }
  }

  if (Number.isFinite(humidity)) {
    if (humidity > thresholds.maxHumidity) {
      alerts.push(`Humidity too high: ${humidity} % > ${thresholds.maxHumidity} %`);
    }

    if (humidity < thresholds.minHumidity) {
      alerts.push(`Humidity too low: ${humidity} % < ${thresholds.minHumidity} %`);
    }
  }

  console.log("Detected alerts:", JSON.stringify(alerts));

  if (alerts.length === 0) {
    return {
      alert: false,
      sent: false,
      message: "No threshold exceeded",
      thresholds,
      dehumidifierAutomation,
      deviceNotifications
    };
  }

  if (!thresholds.measurementNotificationsEnabled) {
    return {
      alert: true,
      sent: false,
      reason: "measurement notifications disabled",
      alerts,
      dehumidifierAutomation,
      deviceNotifications
    };
  }

  const notificationState = {
    alerts,
    temperature,
    humidity,
    thresholds: {
      minTemperature: thresholds.minTemperature,
      maxTemperature: thresholds.maxTemperature,
      minHumidity: thresholds.minHumidity,
      maxHumidity: thresholds.maxHumidity
    }
  };
  const signature = alertSignature(notificationState);
  const previousSignature = await getNotificationSignature(MEASUREMENT_NOTIFICATION_STATE_KEY);
  if (previousSignature === signature) {
    return {
      alert: true,
      sent: false,
      reason: "unchanged measurement alert",
      alerts,
      dehumidifierAutomation,
      deviceNotifications
    };
  }

  try {
    await sendAndroidPush(
      "Storage Retschwil Alert",
      `Temperature: ${temperature} °C\nHumidity: ${humidity} %`,
      { type: "measurement", temperature, humidity }
    );
  } catch (error) {
    console.error("Android push failed for measurement alert:", error);
  }
  await putNotificationSignature(MEASUREMENT_NOTIFICATION_STATE_KEY, signature, notificationState);

  return {
    alert: true,
    sent: true,
    alerts,
    dehumidifierAutomation,
    deviceNotifications
  };
};
