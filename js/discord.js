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