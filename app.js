const API_BASE_URL = "https://onbcgvleu4.execute-api.eu-central-1.amazonaws.com";
const DEVICE_ID = "shellyhtg3-e4b3232fa628";

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
let currentVideoIndex = 0;

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
    const saveBtn = document.getElementById("saveThresholdsButton");
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";

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
    const saveBtn = document.getElementById("saveThresholdsButton");
    saveBtn.disabled = false;
    saveBtn.textContent = "Save";
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
          return this.getLabelForValue(value).split("<br>");
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
  return `${date}<br>${time}`;
}

function formatTimeInline(seconds) {
  const d = new Date(seconds * 1000);
  const date = d.toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric" });
  const time = d.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" });
  return `${date} ${time}`;
}

function formatDateOnly(seconds) {
  return new Date(seconds * 1000).toLocaleDateString(undefined, { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatTimeOnly(seconds) {
  return new Date(seconds * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function formatDateTime(value) {
  return new Date(value).toLocaleString(undefined, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatVideoTimestamp(ms) {
  const totalSeconds = Math.floor(Number(ms || 0) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
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

function calculateTrend(items, field) {
  if (items.length < 2) return "—";
  const first = Number(items[0][field]);
  const last = Number(items[items.length - 1][field]);
  const diff = last - first;
  const sign = diff > 0 ? "+" : "";
  return `${sign}${diff.toFixed(1)} in range`;
}

function setError(message) {
  const box = document.getElementById("errorBox");
  box.textContent = message;
  box.style.display = message ? "block" : "none";
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
        borderColor: "#38bdf8",
        backgroundColor: "rgba(56, 189, 248, 0.12)",
        pointBackgroundColor: chartPointColor(temperatures, isTemperatureAlert, "#38bdf8"),
        pointBorderColor: chartPointColor(temperatures, isTemperatureAlert, "#38bdf8"),
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
        borderColor: "#a78bfa",
        backgroundColor: "rgba(167, 139, 250, 0.12)",
        pointBackgroundColor: chartPointColor(humidities, isHumidityAlert, "#a78bfa"),
        pointBorderColor: chartPointColor(humidities, isHumidityAlert, "#a78bfa"),
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
        <td>${formatTimeInline(item.eventtime)}</td>
        <td class="${thresholdClass(tempAlert)}">
          ${temperature.toFixed(1)} °C
          ${tempAlert ? `<span class="threshold-pill">Alert</span>` : ""}
        </td>
        <td class="${thresholdClass(humidityAlert)}">
          ${humidity.toFixed(1)} %
          ${humidityAlert ? `<span class="threshold-pill">Alert</span>` : ""}
        </td>
        <td>${item.deviceId}</td>
      </tr>
    `;
  }).join("");
}

async function loadData() {
  const hours = document.getElementById("hoursSelect").value;
  const url = `${API_BASE_URL}/measurements?deviceId=${encodeURIComponent(DEVICE_ID)}&hours=${hours}`;

  document.getElementById("statusText").textContent = "Loading data…";
  document.getElementById("statusDot").classList.remove("online", "alert");
  setError("");

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`API returned HTTP ${response.status}`);

    const data = await response.json();
    const items = (data.items || []).sort((a, b) => a.eventtime - b.eventtime);

    if (!items.length) {
      throw new Error("No measurements found for the selected time range.");
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

    document.getElementById("measurementCount").textContent = items.length;
    document.getElementById("lastReadingDate").textContent = formatDateOnly(latest.eventtime);
    document.getElementById("lastReadingTime").textContent = formatTimeOnly(latest.eventtime);
    document.getElementById("tempTrend").textContent = `Trend: ${calculateTrend(items, "temperature")} °C`;
    document.getElementById("humidityTrend").textContent = `Trend: ${calculateTrend(items, "humidity")} %`;

    document.getElementById("tempThresholdInfo").textContent = `Limits: ${LIMITS.minTemperature}–${LIMITS.maxTemperature} °C`;
    document.getElementById("humidityThresholdInfo").textContent = `Limits: ${LIMITS.minHumidity}–${LIMITS.maxHumidity} %`;

    const measurementHealth = document.getElementById("measurementHealth");

    if (latestAlert) {
      measurementHealth.className = "threshold-pill";
      measurementHealth.textContent = "Threshold alert";
      document.getElementById("statusText").textContent = "Online · Current value threshold alert";
      document.getElementById("statusDot").classList.add("alert");
    } else {
      measurementHealth.className = "pill";
      measurementHealth.textContent = "Climate data";
      document.getElementById("statusText").textContent = "Online · API reachable";
      document.getElementById("statusDot").classList.add("online");
    }

    document.getElementById("lastUpdated").textContent = `Last updated: ${new Date().toLocaleTimeString()}`;

    renderCharts(labels, temperatures, humidities);
    renderTable(items);
  } catch (error) {
    console.error(error);
    document.getElementById("statusText").textContent = "Offline or API error";
    setError(error.message);
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

    document.getElementById("videoCounter").textContent = `${videos.length} videos`;
    document.getElementById("videoStatus").textContent = `Videos: ${videos.length} available`;

    if (videos.length) {
      currentVideoIndex = 0;
      renderCurrentVideo();
      renderVideoList();
    } else {
      document.getElementById("videoTitle").textContent = "No videos found";
      document.getElementById("videoMeta").textContent = "—";
      document.getElementById("videoPlayer").removeAttribute("src");
      document.getElementById("videoPlayer").load();
      document.getElementById("videoList").innerHTML = "";
      setVideoButtons(false);
    }
  } catch (error) {
    console.error(error);
    document.getElementById("videoCounter").textContent = "Video API error";
    document.getElementById("videoStatus").textContent = "Videos: API error";
  }
}

async function loadEvents() {
  const url = `${API_BASE_URL}/events`;
  document.getElementById("eventStatus").textContent = "Events: loading…";

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Events API returned HTTP ${response.status}`);

    const data = await response.json();
    events = (data.items || []).filter(item => item.bucketMs === 10000);

    document.getElementById("eventCounter").textContent = `${events.length} events`;
    document.getElementById("eventStatus").textContent = `Events: ${events.length} available`;

    renderEventsTable(events);
  } catch (error) {
    console.error(error);
    document.getElementById("eventCounter").textContent = "Events API error";
    document.getElementById("eventStatus").textContent = "Events: API error";
  }
}

function renderCurrentVideo() {
  if (!videos.length) return;

  const video = videos[currentVideoIndex];
  const player = document.getElementById("videoPlayer");

  player.src = video.url;
  player.load();

  document.getElementById("videoTitle").textContent = video.key;
  document.getElementById("videoMeta").textContent = `${currentVideoIndex + 1} / ${videos.length} · ${formatBytes(video.size)} · ${formatDateTime(video.lastModified)}`;

  setVideoButtons(videos.length > 1);
  renderVideoList();
}

function renderVideoList() {
  const list = document.getElementById("videoList");

  if (!videos.length) {
    list.innerHTML = "";
    return;
  }

  list.innerHTML = videos.map((video, index) => `
    <div class="video-item ${index === currentVideoIndex ? "active" : ""}" data-index="${index}">
      <span class="video-item-name">${video.key}</span>
      <span>${formatBytes(video.size)}</span>
    </div>
  `).join("");

  list.querySelectorAll(".video-item").forEach(item => {
    item.addEventListener("click", () => {
      currentVideoIndex = Number(item.dataset.index);
      renderCurrentVideo();
    });
  });
}

function renderEventsTable(items) {
  const tbody = document.getElementById("eventsTable");

  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="5">No detected events found.</td></tr>`;
    return;
  }

  tbody.innerHTML = items.slice(0, 30).map((item, index) => `
    <tr>
      <td>${formatVideoTimestamp(item.rekognitionTimestampMs)}</td>
      <td><span class="event-label">${item.label}</span></td>
      <td>${Number(item.confidence).toFixed(1)} %</td>
      <td>${item.videoKey}</td>
      <td><button data-event-index="${index}" class="play-event-button">Play</button></td>
    </tr>
  `).join("");

  tbody.querySelectorAll(".play-event-button").forEach(button => {
    button.addEventListener("click", () => {
      playEvent(events[Number(button.dataset.eventIndex)]);
    });
  });
}

function toggleReadings() {
  const content = document.getElementById("readingsContent");
  const toggle = document.getElementById("readingsToggle");
  const isOpen = !content.classList.contains("collapsed");

  content.classList.toggle("collapsed", isOpen);
  toggle.textContent = isOpen ? "Show" : "Hide";
}

function playEvent(eventItem) {
  if (!eventItem || !videos.length) return;

  const videoIndex = videos.findIndex(v => v.key === eventItem.videoKey);

  if (videoIndex === -1) {
    alert(`Video not found in current video list: ${eventItem.videoKey}`);
    return;
  }

  currentVideoIndex = videoIndex;
  renderCurrentVideo();

  const player = document.getElementById("videoPlayer");
  const jumpToSeconds = Math.max(0, Math.floor(Number(eventItem.rekognitionTimestampMs || 0) / 1000));

  player.addEventListener("loadedmetadata", function jumpOnce() {
    player.currentTime = jumpToSeconds;
    player.play().catch(() => {});
    player.removeEventListener("loadedmetadata", jumpOnce);
  });
}

function setVideoButtons(enabled) {
  document.getElementById("prevVideo").disabled = !enabled;
  document.getElementById("nextVideo").disabled = !enabled;
}

function registerEventListeners() {
  document.getElementById("prevVideo").addEventListener("click", () => {
    if (!videos.length) return;
    currentVideoIndex = (currentVideoIndex - 1 + videos.length) % videos.length;
    renderCurrentVideo();
  });

  document.getElementById("nextVideo").addEventListener("click", () => {
    if (!videos.length) return;
    currentVideoIndex = (currentVideoIndex + 1) % videos.length;
    renderCurrentVideo();
  });

  document.getElementById("refreshButton").addEventListener("click", () => {
    loadData();
    loadVideos();
    loadEvents();
  });

  document.getElementById("readingsHeader").addEventListener("click", toggleReadings);
  document.getElementById("hoursSelect").addEventListener("change", loadData);
  document.getElementById("saveThresholdsButton").addEventListener("click", () => saveThresholds(false));
  document.getElementById("cooldownInput").addEventListener("change", applyCooldown);
  document.getElementById("resetCooldownButton").addEventListener("click", resetCooldown);
}

async function init() {
  registerEventListeners();

  await loadThresholds();
  loadData();
  loadVideos();
  loadEvents();

  setInterval(loadData, 60_000);
  setInterval(loadVideos, 300_000);
  setInterval(loadEvents, 300_000);
}

init();
