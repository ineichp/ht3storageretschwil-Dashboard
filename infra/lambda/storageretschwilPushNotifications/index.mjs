import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { createSign } from "node:crypto";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const secretsManager = new SecretsManagerClient({});

const CONFIG_TABLE = process.env.CONFIG_TABLE || "storageretschwilconfig";
const PUSH_TOKENS_KEY = process.env.PUSH_TOKENS_KEY || "androidPushTokens";
const FIREBASE_SECRET_ID = process.env.FIREBASE_SECRET_ID || "storageretschwil/firebase-service-account";
const DASHBOARD_URL = "https://storageretschwil.ortus.one";

let firebaseCredentialCache = null;
let firebaseAccessTokenCache = null;

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
  const unsigned = `${base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64Url(JSON.stringify({
    iss: credentials.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  }))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${signer.sign(credentials.private_key, "base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;

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

  return Object.entries(result.Item?.tokens || {})
    .map(([tokenId, item]) => ({ tokenId, ...item }))
    .filter(item => item?.enabled !== false && item?.token);
}

function isUnregisteredToken(payload = {}) {
  return (payload.error?.details || []).some(detail =>
    detail?.["@type"] === "type.googleapis.com/google.firebase.fcm.v1.FcmError" &&
    ["UNREGISTERED", "INVALID_ARGUMENT"].includes(detail.errorCode)
  );
}

async function removePushToken(tokenId) {
  await ddb.send(new UpdateCommand({
    TableName: CONFIG_TABLE,
    Key: { configKey: PUSH_TOKENS_KEY },
    UpdateExpression: "REMOVE tokens.#tokenId SET updatedAt = :updatedAt",
    ExpressionAttributeNames: {
      "#tokenId": tokenId
    },
    ExpressionAttributeValues: {
      ":updatedAt": new Date().toISOString()
    }
  }));
}

export const handler = async (event = {}) => {
  const title = String(event.title || "Storage Retschwil Alert");
  const body = String(event.body || "Storage Retschwil Alert");
  const data = event.data && typeof event.data === "object" ? event.data : {};
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
  let removed = 0;
  let cleanupFailed = 0;

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
            url: DASHBOARD_URL
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
      let payload = {};
      try {
        payload = JSON.parse(text);
      } catch {
        payload = {};
      }
      if (isUnregisteredToken(payload)) {
        try {
          await removePushToken(item.tokenId);
          removed += 1;
        } catch (error) {
          cleanupFailed += 1;
          console.error("Unable to remove stale Android push token:", error.message);
        }
      }
    }
  }));

  return { sent, failed, removed, cleanupFailed };
};
