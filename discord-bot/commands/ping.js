const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check whether Black Market Advisor is online.'),

  async execute(interaction) {
    await interaction.reply(
      '🏓 Pong! Black Market Advisor is online.'
    );
  }
};