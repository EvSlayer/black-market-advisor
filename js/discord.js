const DISCORD_SETTINGS_KEY = 'bm_discord_settings_v1';

function loadDiscordSettings() {
  try {
    return JSON.parse(
      localStorage.getItem(DISCORD_SETTINGS_KEY) ||
      '{"enabled":false,"webhookUrl":""}'
    );
  } catch (error) {
    return {
      enabled: false,
      webhookUrl: ''
    };
  }
}

function saveDiscordSettings(settings) {
  localStorage.setItem(
    DISCORD_SETTINGS_KEY,
    JSON.stringify(settings)
  );
}

async function sendDiscordWebhookMessage(message) {
  const settings = loadDiscordSettings();

  if (!settings.enabled) {
    throw new Error('Discord alerts are disabled.');
  }

  if (!settings.webhookUrl) {
    throw new Error('Discord webhook URL is missing.');
  }

  const response = await fetch(settings.webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      username: 'Black Market Advisor',
      content: message
    })
  });

  if (!response.ok) {
    throw new Error(
      `Discord returned ${response.status} ${response.statusText}`
    );
  }

  return true;
}

async function sendDiscordTestAlert() {
  return sendDiscordWebhookMessage(
    [
      '✅ **Black Market Advisor connected**',
      '',
      'Discord notifications are working.',
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