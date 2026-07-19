const fs = require('fs');
const path = require('path');

const alertsFile = path.join(__dirname, '..', 'data', 'alerts.json');

function loadAlerts() {
  try {
    const data = fs.readFileSync(alertsFile, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Could not load alerts.json:', error);
    return [];
  }
}

function saveAlerts(alerts) {
  try {
    fs.writeFileSync(
      alertsFile,
      JSON.stringify(alerts, null, 2),
      'utf8'
    );
  } catch (error) {
    console.error('Could not save alerts.json:', error);
  }
}

module.exports = {
  loadAlerts,
  saveAlerts
};