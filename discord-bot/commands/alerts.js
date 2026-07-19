const { SlashCommandBuilder } = require('discord.js');
const {
  loadAlerts,
  saveAlerts
} = require('../storage/alerts');

const commodityNames = {
  uranium: 'Uranium',
  stolen_arts: 'Stolen Arts',
  military_hardware: 'Military Hardware',
  prescription_pills: 'Prescription Pills',
  counterfeit_cash: 'Counterfeit Cash',
  exotic_animals: 'Exotic Animals'
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('alert')
    .setDescription('Manage your personal market alerts.')
    .addSubcommand(subcommand =>
      subcommand
        .setName('add')
        .setDescription('Create a new market alert.')
        .addStringOption(option =>
          option
            .setName('commodity')
            .setDescription('Commodity to monitor.')
            .setRequired(true)
            .addChoices(
              { name: 'Uranium', value: 'uranium' },
              { name: 'Stolen Arts', value: 'stolen_arts' },
              { name: 'Military Hardware', value: 'military_hardware' },
              { name: 'Prescription Pills', value: 'prescription_pills' },
              { name: 'Counterfeit Cash', value: 'counterfeit_cash' },
              { name: 'Exotic Animals', value: 'exotic_animals' }
            )
        )
        .addStringOption(option =>
          option
            .setName('condition')
            .setDescription('When should the alert trigger?')
            .setRequired(true)
            .addChoices(
              { name: 'Price falls below', value: 'below' },
              { name: 'Price rises above', value: 'above' }
            )
        )
        .addNumberOption(option =>
          option
            .setName('price')
            .setDescription('Target price.')
            .setRequired(true)
            .setMinValue(0)
        )
        )
   
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('View your saved market alerts.')
    )
    .addSubcommand(subcommand =>
  subcommand
    .setName('remove')
    .setDescription('Delete one of your saved market alerts.')
    .addStringOption(option =>
      option
        .setName('alert')
        .setDescription('Select the alert you want to delete.')
        .setRequired(true)
        .setAutocomplete(true)
    )
),

async autocomplete(interaction) {
  const alerts = loadAlerts().filter(
    alert => alert.userId === interaction.user.id
  );

  const choices = alerts.slice(0, 25).map(alert => {
    const conditionText =
      alert.condition === 'below'
        ? 'Below'
        : 'Above';

    return {
      name:
        `${commodityNames[alert.commodity]} — ` +
        `${conditionText} $${alert.price.toLocaleString()}`,
      value: alert.id
    };
  });

  await interaction.respond(choices);
},

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

   if (subcommand === 'list') {
  const alerts = loadAlerts().filter(
    alert => alert.userId === interaction.user.id
  );

  if (alerts.length === 0) {
    await interaction.reply({
      content: '📋 You do not have any saved alerts.',
      ephemeral: true
    });
    return;
  }

  const alertLines = alerts.map((alert, index) => {
    const conditionText =
      alert.condition === 'below'
        ? 'Below'
        : 'Above';

    return (
      `**${index + 1}. ${commodityNames[alert.commodity]}**\n` +
      `${conditionText} $${alert.price.toLocaleString()}`
    );
  });

  await interaction.reply({
    content:
      `📋 **Your Alerts**\n\n` +
      alertLines.join('\n\n'),
    ephemeral: true
  });

  return;
}

if (subcommand === 'remove') {
  const alertId = interaction.options.getString('alert');
  const alerts = loadAlerts();

  const alertToRemove = alerts.find(
    alert =>
      alert.id === alertId &&
      alert.userId === interaction.user.id
  );

  if (!alertToRemove) {
    await interaction.reply({
      content: '❌ That alert could not be found.',
      ephemeral: true
    });
    return;
  }

  const updatedAlerts = alerts.filter(
    alert => alert.id !== alertToRemove.id
  );

  saveAlerts(updatedAlerts);

  const conditionText =
    alertToRemove.condition === 'below'
      ? 'Below'
      : 'Above';

  await interaction.reply({
    content:
      `🗑️ Alert deleted\n` +
      `**Commodity:** ${commodityNames[alertToRemove.commodity]}\n` +
      `**Condition:** ${conditionText} $${alertToRemove.price.toLocaleString()}`,
    ephemeral: true
  });

  return;
}



if (subcommand !== 'add') {
  return;
}

    const commodity = interaction.options.getString('commodity');
    const condition = interaction.options.getString('condition');
    const price = interaction.options.getNumber('price');

    const alerts = loadAlerts();

    alerts.push({
      id: Date.now().toString(),
      userId: interaction.user.id,
      username: interaction.user.username,
      commodity,
      condition,
      price,
      createdAt: new Date().toISOString()
    });

    saveAlerts(alerts);

    const conditionText =
      condition === 'below'
        ? 'falls below'
        : 'rises above';

    await interaction.reply({
      content:
        `✅ Alert created\n` +
        `**Commodity:** ${commodityNames[commodity]}\n` +
        `**Condition:** Price ${conditionText} $${price.toLocaleString()}`,
      ephemeral: true
    });
  }
};