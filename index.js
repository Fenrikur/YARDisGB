const { prefix, token, gameSettings } = require('./config.json');
const fs = require('fs');
const Discord = require('discord.js');

function loadGames(gamesDir) {
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

	return games;
}

const client = new Discord.Client();

const games = loadGames('./games');
const gameSessions = new Discord.Collection();

client.once('ready', () => {
	client.user.setStatus('online');
	client.user.setActivity('🐺🐺🐺🌕', { type: 'WATCHING' })
		.then(presence => console.log(`Activity set to ${presence.activities[0].name}`))
		.catch(console.error);
	console.log('Ready!');
});

client.on('message', message => {
	console.log(message);
	if (message.author.id === client.user.id) {
		console.log('Message by myself. Let\'s not go there again …');
		return;
	} else if (message.author.bot) {
		console.log('Message by another bot. Not playing that game, buddy …');
		return;
	} else if (message.system) {
		console.log('Message by the system. Couldn\'t care less …');
		return;
	}

	const gameSession = gameSessions.get(message.channel.id);

	if (message.content.startsWith(prefix)) {
		const input = message.content.slice(prefix.length).trim().split(' ');
		const command = input.shift();
		const commandArgs = input.join(' ');
		const gameId = commandArgs.replace(/[^A-Za-z0-9]/g, '');

		if (command === 'help' && message.guild) {
			message.reply(`the following commands are available:${}`);
		} else if (command === 'list' && message.guild) {
			message.reply(`the following games are currently available:\n${games.reduce((listString, listGame, listGameId) => { return `${listString}\t- ${listGame.name} (\`${listGameId}\`)\n`; }, '')}Use \`${prefix}start <gameId>\` to start one of them or \`${prefix}rules <gameId>\` to read its rules.`);
		} else if (command === 'start' && message.guild) {
			if (!gameId) {
				message.reply(`you forgot to add the name of the game you wish to start. Use \`${prefix}list\` to retrieve a list of available games.`);
			} else if (!games.has(gameId)) {
				message.reply(`there is no game **${gameId}**. Use \`${prefix}list\` to retrieve a list of available games.`);
			} else if (!gameSession) {
				const game = games.get(gameId);
				console.log(`Starting the game ${game.name} (${game.id}) in channel ${message.channel.name} (${message.channel.id})`);
				gameSessions.set(message.channel.id, {
					id: gameId,
					game: game,
					data: game.start(),
					settings: gameSettings[gameId],
				});
				message.react('🎬');
				message.reply(`let's play ${game.name}! Use \`${prefix}rules\` if you want to know the rules.`);
			} else {
				message.reply(`there is already a game of ${gameSession.game.name} running in this channel. Please stop it first with \`${prefix}stop\`.`);
			}
		} else if (command === 'restart' && message.guild) {
			if (gameSession) {
				console.log(`Restarting the game ${gameSession.game.name} (${gameSession.game.id}) in channel ${message.channel.name} (${message.channel.id})`);
				gameSession.data = gameSession.game.start();
				message.react('🔄');
			} else {
				message.reply(`there is currently no game running in this channel. Try starting one with \`${prefix}start <gameId>\``);
			}
		} else if (command === 'stop' && message.guild) {
			if (gameSession) {
				console.log(`Ending the game ${gameSession.game.name} (${gameSession.game.id}) in channel ${message.channel.name} (${message.channel.id})`);
				gameSessions.delete(message.channel.id);
				message.react('🏁');
			} else {
				message.reply(`there is currently no game running in this channel. Try starting one with \`${prefix}start <gameId>\``);
			}
		} else if (command === 'rules') {
			if (gameSession) {
				message.reply(`I will gladly explain the rules of the game ${gameSession.game.name} to you:\n\n ${gameSession.game.rules(gameSession.settings)}`);
			} else if (gameId) {
				const game = games.get(gameId);
				if (game) {
					message.reply(`I will gladly explain the rules of the game ${game.name} to you:\n\n ${game.rules(gameSettings[gameId])}`);
				} else {
					message.reply(`there is no game **${gameId}**. Use \`${prefix}list\` to retrieve a list of available games.`);
				}
			} else {
				message.reply(`there is currently no game running in this channel. Try starting one with \`${prefix}start <gameId>\` or asking for the rules for a specific game with \`${prefix}rules <gameId>\`.`);
			}
		} else {
			message.reply(`the command \`${prefix}${command}\` is unknown.\nTry \`${prefix}help\`, \`${prefix}list\`, ${gameSession ? `\`${prefix}rules\`, \`${prefix}restart\` or \`${prefix}stop\`` : `\`${prefix}start <gameId>\` or \`${prefix}rules <gameId>\``}.`);
		}
	} else if (gameSession) {
		gameSession.game.onMessage(gameSession.settings, gameSession.data, message);
	}
});

client.on('messageUpdate', (oldMessage, newMessage) => {
	const gameSession = gameSessions.get(oldMessage.channel.id);
	if (gameSession) {
		gameSession.game.onMessageUpdate(gameSession.settings, gameSession.data, oldMessage, newMessage);
	}
});

client.on('messageDelete', message => {
	const gameSession = gameSessions.get(message.channel.id);
	if (gameSession) {
		gameSession.game.onMessageUpdate(gameSession.settings, gameSession.data, message);
	}
});

client.login(token);