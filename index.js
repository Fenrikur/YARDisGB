const { prefix: PREFIX } = require('./config.json');
const fs = require('fs');
const Discord = require('discord.js');
const AsyncLock = require('async-lock');

const client = new Discord.Client();

client.loadGames = function(gamesDir) {
	if (!gamesDir.endsWith('/')) {
		gamesDir += '/';
	}

	const games = new Discord.Collection();
	const gameFiles = fs.readdirSync(gamesDir).filter(file => file.endsWith('.js'));
	for (const file of gameFiles) {
		const game = require(`${gamesDir}${file}`);
		const gameName = file.split('.', 2)[0];
		games.set(gameName, game);
		console.log('Added game', gameName, 'to list of available games.');
	}

	this.games = games;
};

client.once('ready', () => {
	client.user.setStatus('online');
	client.user.setActivity('🐺🐺🐺🌕', { type: 'WATCHING' })
		.then(presence => console.log(`Activity set to ${presence.activities[0].name}`))
		.catch(console.error);
	console.log('Ready!');
});

client.on('message', async message => {
	client.globalSettings.debugMode && console.log(message);
	if (message.author.id === client.user.id) {
		client.globalSettings.debugMode && console.log('Message by myself. Let\'s not go there again …');
		return;
	} else if (message.author.bot) {
		client.globalSettings.debugMode && console.log('Message by another bot. Not playing that game, buddy …');
		return;
	} else if (message.system) {
		client.globalSettings.debugMode && console.log('Message by the system. Couldn\'t care less …');
		return;
	}

	const gameSession = client.gameSessions.get(message.channel.id);

	if (message.content.startsWith(PREFIX)) {
		const input = message.content.slice(PREFIX.length).trim().split(' ');
		const command = input.shift();
		const commandArgs = input.join(' ');
		const gameId = commandArgs.replace(/[^A-Za-z0-9]/g, '');

		if (command === 'help' && !message.guild) {
			message.author.send(`The following commands are available:${PREFIX}...`);
		} else if (command === 'list' && !message.guild) {
			message.author.send(`The following games are currently available:\n${client.games.reduce((listString, listGame, listGameId) => { return `${listString}\t- ${listGame.name} (\`${listGameId}\`)\n`; }, '')}Use \`${PREFIX}start <gameId>\` in the respective channel to start one of them there or \`${PREFIX}rules <gameId>\` in here to read its rules.`);
		} else if (command === 'start' && message.guild) {
			if (gameSession) {
				message.author.send(`There is already a game of ${gameSession.game.name} running in #${message.channel.name} on ${message.guild.name}. Please stop it first by sending \`${PREFIX}stop\` to that channel.`);
			} else if (!gameId) {
				message.author.send(`You forgot to add the name of the game you wish to start. Use \`${PREFIX}list\` in here to retrieve a list of available games.`);
			} else if (!client.games.has(gameId)) {
				message.author.send(`There is no game **${gameId}**. Use \`${PREFIX}list\` in here to retrieve a list of available games.`);
			} else {
				const game = client.games.get(gameId);
				console.log(`Starting the game ${game.name} (${gameId}) in channel ${message.channel.name} (${message.channel.id})`);
				client.gameSessions.set(message.channel.id, {
					id: gameId,
					game: game,
					data: game.start(),
					settings: client.gameSettings[gameId],
				});
				message.react('🎬');
				message.channel.send(`Let's play ${game.name}! Use \`${PREFIX}rules\` if you want to know the rules.`);
			}
		} else if (command === 'restart' && message.guild) {
			if (gameSession) {
				console.log(`Restarting the game ${gameSession.game.name} (${gameSession.game.id}) in channel ${message.channel.name} (${message.channel.id})`);
				gameSession.data = gameSession.game.start(client.globalSettings);
				message.react('🔄');
			} else {
				message.author.send(`There is currently no game running in #${message.channel.name} on ${message.guild.name}. Try starting one there with \`${PREFIX}start <gameId>\``);
			}
		} else if (command === 'stop' && message.guild) {
			if (gameSession) {
				console.log(`Ending the game ${gameSession.game.name} (${gameSession.game.id}) in channel ${message.channel.name} (${message.channel.id})`);
				client.gameSessions.delete(message.channel.id);
				message.react('🏁');
			} else {
				message.author.send(`There is currently no game running in #${message.channel.name} on ${message.guild.name}. Try starting one there with \`${PREFIX}start <gameId>\``);
			}
		} else if (command === 'crules' && message.guild) {
			if (gameSession) {
				message.channel.send(`The rules of the game ${gameSession.game.name} are as follows:\n\n ${gameSession.game.rules(client.globalSettings, gameSession.settings)}`);
			} else if (gameId) {
				const game = client.games.get(gameId);
				if (game) {
					message.channel.send(`The rules of the game ${game.name} are as follows:\n\n ${game.rules(client.globalSettings, client.gameSettings[gameId])}`);
				} else {
					message.author.send(`There is no game **${gameId}**. Use \`${PREFIX}list\` in here to retrieve a list of available games.`);
				}
			}
		} else if (command === 'rules') {
			if (gameSession) {
				message.author.send(`I will gladly explain the rules of the game ${gameSession.game.name} in #${message.channel.name} on ${message.guild.name} to you:\n\n ${gameSession.game.rules(client.globalSettings, gameSession.settings)}`);
			} else if (gameId) {
				const game = client.games.get(gameId);
				if (game) {
					message.author.send(`I will gladly explain the rules of the game ${game.name} to you:\n\n ${game.rules(client.globalSettings, client.gameSettings[gameId])}`);
				} else {
					message.author.send(`There is no game **${gameId}**. Use \`${PREFIX}list\` in here to retrieve a list of available games.`);
				}
			} else if(message.guild) {
				message.author.send(`There is currently no game running in #${message.channel.name} on ${message.guild.name}. Try starting one in there with \`${PREFIX}start <gameId>\` or asking me here for the rules for a specific game with \`${PREFIX}rules <gameId>\`.`);
			} else {
				message.author.send(`You forgot to add the name of the game you wish to know the rules for. Use \`${PREFIX}list\` in here to retrieve a list of available games.`);
			}
		} else {
			message.author.send(`The command \`${PREFIX}${command}\` is unknown.\nTry \`${PREFIX}help\` in here for a list of available commands.`);
		}
	} else if (gameSession) {
		await client.gameSessionLocks.acquire(message.channel.id, async () => {
			await gameSession.game.onMessage(client.globalSettings, gameSession.settings, gameSession.data, message);
		});
	}
});

client.on('messageUpdate', async (oldMessage, newMessage) => {
	const gameSession = client.gameSessions.get(oldMessage.channel.id);
	if (gameSession) {
		await client.gameSessionLocks.acquire(oldMessage.channel.id, async () => {
			await gameSession.game.onMessageUpdate(client.globalSettings, gameSession.settings, gameSession.data, oldMessage, newMessage);
		});
	}
});

client.on('messageDelete', async message => {
	const gameSession = client.gameSessions.get(message.channel.id);
	if (gameSession) {
		await client.gameSessionLocks.acquire(message.channel.id, async () => {
			await gameSession.game.onMessageUpdate(client.globalSettings, gameSession.settings, gameSession.data, message);
		});
	}
});


(function() {
	const { globalSettings, gameSettings, token: TOKEN } = require('./config.json');
	client.globalSettings = globalSettings;
	client.gameSettings = gameSettings;
	client.gameSessions = new Discord.Collection();
	client.gameSessionLocks = new AsyncLock();

	client.loadGames('./games');
	client.login(TOKEN);
}());
