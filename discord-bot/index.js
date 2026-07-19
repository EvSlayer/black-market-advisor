require('dotenv').config();

const fs = require('fs');
const path = require('path');

const {
  Client,
  Collection,
  GatewayIntentBits,
  REST,
  Routes
} = require('discord.js');

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.commands = new Collection();

const commands = [];
const commandsPath = path.join(__dirname, 'commands');

const commandFiles = fs
  .readdirSync(commandsPath)
  .filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);

  if (!command.data || !command.execute) {
    console.warn(`Skipped invalid command file: ${file}`);
    continue;
  }

  client.commands.set(command.data.name, command);
  commands.push(command.data.toJSON());
}

client.once('clientReady', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(
    process.env.DISCORD_BOT_TOKEN
  );

  try {
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: [] }
    );

    await rest.put(
      Routes.applicationGuildCommands(
        client.user.id,
        '1527151590006325420'
      ),
      { body: commands }
    );

    console.log('Slash commands registered.');
  } catch (error) {
    console.error('Failed to register slash commands:', error);
  }
});

client.on('interactionCreate', async interaction => {
  const command = client.commands.get(interaction.commandName);

  if (!command) {
    console.error(
      `No command found for /${interaction.commandName}`
    );
    return;
  }

  if (interaction.isAutocomplete()) {
    try {
      if (command.autocomplete) {
        await command.autocomplete(interaction);
      }
    } catch (error) {
      console.error(
        `Error handling autocomplete for /${interaction.commandName}:`,
        error
      );
    }

    return;
  }

  if (!interaction.isChatInputCommand()) {
    return;
  }

 

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(
      `Error executing /${interaction.commandName}:`,
      error
    );

    const response = {
      content: '❌ Something went wrong while running that command.',
      ephemeral: true
    };

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(response);
    } else {
      await interaction.reply(response);
    }
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);