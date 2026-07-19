const DISCORD_SETTINGS_KEY = 'bm_discord_settings_v2';
const DISCORD_SERVER_URL = 'http://localhost:3000/send-alert';

function loadDiscordSettings() {
  try {
    return JSON.parse(
      localStorage.getItem(DISCORD_SETTINGS_KEY) ||
      '{"enabled":false}'
    );
  } catch (error) {
    return {
      enabled: false
    };
  }
}

function saveDiscordSettings(settings) {
  localStorage.setItem(
    DISCORD_SETTINGS_KEY,
    JSON.stringify({
      enabled: !!settings.enabled
    })
  );
}

async function sendDiscordWebhookMessage(message) {
  const settings = loadDiscordSettings();

  if (!settings.enabled) {
    throw new Error('Discord alerts are disabled.');
  }

  const response = await fetch(DISCORD_SERVER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message
    })
  });

  let responseBody = null;

  try {
    responseBody = await response.json();
  } catch (error) {
    // The server may return an empty or non-JSON response.
  }

  if (!response.ok) {
    throw new Error(
      responseBody?.error ||
      `Discord alert server returned ${response.status} ${response.statusText}`
    );
  }

  return true;
}

async function sendDiscordTestAlert() {
  return sendDiscordWebhookMessage(
    [
      '✅ **Black Market Advisor connected**',
      '',
      'Discord notifications are working through the local alert server.',
      `Test sent: ${new Date().toLocaleString()}`
    ].join('\n')
  );
}

const DISCORD_ALERT_STATE_KEY = 'bm_discord_alert_state_v1';

function loadDiscordAlertState() {
  try {
    return JSON.parse(
      localStorage.getItem(DISCORD_ALERT_STATE_KEY) || '{"buyZones":{}}'
    );
  } catch (error) {
    return { buyZones: {} };
  }
}

function saveDiscordAlertState(state) {
  localStorage.setItem(
    DISCORD_ALERT_STATE_KEY,
    JSON.stringify(state)
  );
}

async function sendBuyZoneAlert(option) {
  const message = [
    '🟢 **BUY ZONE ALERT**',
    '',
    `**Commodity:** ${option.name}`,
    `**Current price:** ${fmt(option.price)}`,
    `**Buy threshold:** ${fmt(option.buyThreshold)}`,
    `**Estimated upside:** ${pct(option.upsidePct || 0)}`,
    '',
    'The commodity has entered its configured buy zone.'
  ].join('\n');

  return sendDiscordWebhookMessage(message);
}

async function checkDiscordBuyZoneAlerts(result) {
  const settings = loadDiscordSettings();

  if (!settings.enabled || !result?.commodityOptions?.length) {
    return;
  }

  const state = loadDiscordAlertState();
  state.buyZones ||= {};

  for (const option of result.commodityOptions) {
    const wasInBuyZone = !!state.buyZones[option.key];
    const isInBuyZone = !!option.inManualBuyZone;

    if (isInBuyZone && !wasInBuyZone) {
      try {
        await sendBuyZoneAlert(option);
        state.buyZones[option.key] = true;
      } catch (error) {
        console.error(
          `Discord buy-zone alert failed for ${option.name}:`,
          error
        );
      }
    } else if (!isInBuyZone && wasInBuyZone) {
      state.buyZones[option.key] = false;
    }
  }

  saveDiscordAlertState(state);
}