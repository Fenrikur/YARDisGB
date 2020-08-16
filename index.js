/*
    YARDisGB – Yet Another Random Discord Game Bot
    Copyright (C) 2020  Dominik "Fenrikur" Schöner <yardisgb@fenrikur.de>

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

const { prefix: PREFIX } = require('./config.json');
const fs = require('fs');
const Discord = require('discord.js');
const AsyncLock = require('async-lock');

const client = new Discord.Client();

client.loadGames = function () {
	const gamesDir = client.globalSettings.gamesDir;

	const games = new Discord.Collection();
	const gameFiles = fs.readdirSync(gamesDir).filter(file => file.endsWith('.js'));
	for (const file of gameFiles) {
		const game = require(`${gamesDir}/${file}`);
		games.set(game.id, game);
		console.log('Added the game', game.name, 'with id', game.id, 'to the list of available games.');
	}

	this.games = games;
};

client.restoreGameSessions = function () {
	const sessionsDir = client.globalSettings.sessionsDir;

	if (!fs.existsSync(sessionsDir)) {
		console.log(`Sessions directory ${sessionsDir} was missing, so nothing to restore apart from the directory itself.`);
		fs.mkdirSync(sessionsDir);
		return;
	}

	const gameSessions = new Discord.Collection();
	const sessionFiles = fs.readdirSync(sessionsDir).filter(file => file.endsWith('.json'));
	for (const file of sessionFiles) {
		const gameSession = require(`${sessionsDir}/${file}`);
		const game = client.games.get(gameSession.game.id);
		if (game) {
			gameSession.game = game;
			if (game.restoreData) {
				gameSession.data = game.restoreData(gameSession.data);
			}
			gameSessions.set(gameSession.id, gameSession);
			console.log(`Restored session ${gameSession.id} of the game ${game.name} with id ${game.id}.`);
		} else {
			console.log(`Failed to restore session ${gameSession.id} of the game ${gameSession.game.name} with id ${gameSession.game.id} as the game itself is missing.`);
		}
	}

	this.gameSessions = gameSessions;
};

client.storeGameSession = function (gameSession) {
	fs.writeFileSync(`${client.globalSettings.sessionsDir}/${gameSession.id}.json`, JSON.stringify(gameSession));
};

client.startGame = async function (gameId, sessionId) {
	const game = client.games.get(gameId);
	const gameSession = {
		id: sessionId,
		game: game,
		data: game.start(),
		settings: client.gameSettings[gameId],
		restartVoteCount: 0,
		restartVoteMessage: null,
		restartVoteTimeout: null,
	};
	client.gameSessions.set(gameSession.id, gameSession);
	gameSession.game.onStart && await gameSession.game.onStart(client.globalSettings, gameSession.settings, gameSession.data, await client.channels.fetch(gameSession.id, true));
	client.storeGameSession(gameSession);

	return gameSession;
};

client.stopGame = async function (gameSession) {
	gameSession.game.onEnd && await gameSession.game.onEnd(client.globalSettings, gameSession.settings, gameSession.data, await client.channels.fetch(gameSession.id, true));
	console.log(client.gameSessions.delete(gameSession.id));
	fs.unlinkSync(`${client.globalSettings.sessionsDir}/${gameSession.id}.json`);
};

client.restartGame = async function (gameSession) {
	await client.clearRestartVote(gameSession);
	await client.gameSessionLocks.acquire(gameSession.id, async () => {
		gameSession.game.onRestart && await gameSession.game.onRestart(client.globalSettings, gameSession.settings, gameSession.data, await client.channels.fetch(gameSession.id, true));
		gameSession.data = gameSession.game.start(client.globalSettings);
		client.storeGameSession(gameSession);
	});
};

client.startRestartVote = async function (gameSession, message) {
	await client.gameSessionLocks.acquire(gameSession.id, async () => {
		const voteMessage = await message.reply(`your request to restart the game requires ${client.getEffectiveSettingValue('unprivilegedRestartVotes', gameSession)} votes to succeed. Everybody who wishes to support your request can vote by reacting to this message with 👍. Voting will be open for the next ${Math.round(client.getEffectiveSettingValue('unprivilegedRestartVoteDurationSeconds', gameSession) / 60)} minutes and ${Math.round(client.getEffectiveSettingValue('unprivilegedRestartVoteDurationSeconds', gameSession) % 60)} seconds.`);
		voteMessage.react('👍');
		gameSession.restartVoteMessage = voteMessage;
		gameSession.restartVoteTimeout = setTimeout(async (voteGameSession) => {
			try {
				await voteMessage.reactions.removeAll();
			} catch (reason) {
				client.globalSettings.debugMode && console.log('Failed to remove reactions:', reason);
			}
			voteMessage.react('🚫');
			await client.clearRestartVote(voteGameSession);
		}, client.getEffectiveSettingValue('unprivilegedRestartVoteDurationSeconds', gameSession) * 1000, gameSession);
	});
};

client.clearRestartVote = async function (gameSession) {
	await client.gameSessionLocks.acquire(gameSession.id, async () => {
		clearTimeout(gameSession.restartVoteTimeout);
		gameSession.restartVoteMessage = null;
		gameSession.restartVoteTimeout = null;
	}, { domainReentrant: true });
};

client.isOverridableSetting = function (setting) {
	switch (setting) {
		case 'unprivilegedRestartVotes':
			return true;
		case 'unprivilegedRestartVoteDurationSeconds':
			return true;
		case 'ignorePrefix':
			return true;
		default:
			return false;
	}
};

client.validateOverridableSetting = function (setting, value) {
	if (!setting || !value) {
		return false;
	}

	switch (setting) {
		case 'unprivilegedRestartVotes':
			return value.match(/^[0-9]+$/) && value >= 0 && value <= 1000;
		case 'unprivilegedRestartVoteDurationSeconds':
			return value.match(/^[0-9]+$/) && value >= 0;
		case 'ignorePrefix':
			return value === 'false' || value.length > 0;
		default:
			return false;
	}
};

client.parseOverridableSetting = function (setting, value) {
	if (!setting || !value || !client.validateOverridableSetting(setting, value)) {
		return undefined;
	}

	switch (setting) {
		case 'unprivilegedRestartVotes':
			return Number.parseInt(value);
		case 'unprivilegedRestartVoteDurationSeconds':
			return Number.parseInt(value);
		case 'ignorePrefix':
			return value === 'false' ? false : value;
		default:
			return undefined;
	}
};

client.getEffectiveSettingValue = function (setting, gameSession) {
	if (!client.isOverridableSetting(setting) || gameSession.settings[setting] === undefined) {
		return client.globalSettings[setting];
	} else {
		return gameSession.settings[setting];
	}
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
	const isPrivileged = !client.globalSettings.isPrivilegedRole || (message.member && message.member.roles.cache.some(role => role.name === client.globalSettings.isPrivilegedRole));

	if (message.content.startsWith(PREFIX)) {
		const input = message.content.slice(PREFIX.length).trim().split(' ');
		const command = input.shift();
		const commandArgs = input.join(' ');
		const gameId = commandArgs.replace(/[^A-Za-z0-9]/g, '');

		if (command === 'help') {
			message.author.send(`The following commands are available:\n\t- \`${PREFIX}help\`: (DM/Channel) Might provide more commands when used in a channel on a server where you have privileges.\n\t- \`${PREFIX}list\`: (DM) Receive a list of all available games.\n\t- \`${PREFIX}rules\`: (Channel) Get the rules for the game currently running in the channel.\n\t- \`${PREFIX}rules <gameId>\`: (DM) Get the rules for a specific game.${isPrivileged ? `\n\t- \`${PREFIX}start <gameId>\`: (Channel) Start a new game in a channel.\n\t- \`${PREFIX}stop\`: (Channel) Stop the game currently running in a channel.\n\t- \`${PREFIX}restart\`: (Channel) Restart the game currently running in a channel.\n\t- \`${PREFIX}crules\`: (Channel) Output the rules of the currently running game to the channel.` : `\n\t- \`${PREFIX}restart\`: (Channel) Trigger a vote to restart the game currently running in a channel.`}\n\nYou can find my code at: https://github.com/Fenrikur/YARDisGB`);
		} else if (command === 'list') {
			message.author.send(`The following games are currently available:\n${client.games.reduce((listString, listGame, listGameId) => { return `${listString}\t- ${listGame.name} (\`${listGameId}\`)\n`; }, '')}Use \`${PREFIX}start <gameId>\` in the respective channel to start one of them there or \`${PREFIX}rules <gameId>\` in here to read its rules.\nWant to add your own game? Check out my repository at https://github.com/Fenrikur/YARDisGB`);
		} else if (command === 'start' && message.guild && isPrivileged) {
			if (gameSession) {
				message.author.send(`There is already a game of ${gameSession.game.name} running in #${message.channel.name} on ${message.guild.name}. Please stop it first by sending \`${PREFIX}stop\` to that channel.`);
			} else if (!gameId) {
				message.author.send(`You forgot to add the name of the game you wish to start. Use \`${PREFIX}list\` in here to retrieve a list of available games.`);
			} else {
				const newGameSession = await client.startGame(gameId, message.channel.id);
				if (!newGameSession) {
					message.author.send(`There is no game **${gameId}**. Use \`${PREFIX}list\` in here to retrieve a list of available games.`);
				} else {
					console.log(`Started the game ${newGameSession.game.name} (${gameId}) in channel ${message.channel.name} (${message.channel.id}) on ${message.guild.name} (${message.guild.id}).`);
					message.react('🎬');
					message.channel.send(`Let's play ${newGameSession.game.name}! Use \`${PREFIX}rules\` if you want to know the rules.`);
				}
			}
		} else if (command === 'restart' && message.guild) {
			if (gameSession) {
				if ((isPrivileged && commandArgs === 'now') || (client.getEffectiveSettingValue('unprivilegedRestartVotes', gameSession) === 0 && client.getEffectiveSettingValue('unprivilegedRestartVoteDurationSeconds', gameSession) > 0)) {
					console.log(`Restarting the game ${gameSession.game.name} (\`${gameSession.game.id}\`) in channel ${message.channel.name} (${message.channel.id}) on ${message.guild.name} (${message.guild.id}).`);
					await message.react('🔄');
					await client.restartGame(gameSession);
					message.channel.send(`🔄 Restarting the game ${gameSession.game.name} in 3, 2, 1 …`);
				} else if (client.getEffectiveSettingValue('unprivilegedRestartVoteDurationSeconds', gameSession) > 0 && client.getEffectiveSettingValue('unprivilegedRestartVotes', gameSession) > 0) {
					if (gameSession.restartVoteMessage === null) {
						client.startRestartVote(gameSession, message);
					} else {
						message.author.send(`There is already a restart vote running in #${message.channel.name} on ${message.guild.name}. Please participate in this vote instead of trying to start a new one.`);
					}
				} else {
					message.react('🚫');
				}
			} else {
				message.author.send(`There is currently no game running in #${message.channel.name} on ${message.guild.name}. Try starting one there with \`${PREFIX}start <gameId>\`.`);
			}
		} else if (command === 'stop' && message.guild && isPrivileged) {
			if (gameSession) {
				console.log(`Ending the game ${gameSession.game.name} (\`${gameSession.game.id}\`) in channel ${message.channel.name} (${message.channel.id})`);
				await client.stopGame(gameSession);
				message.react('🏁');
			} else {
				message.author.send(`There is currently no game running in #${message.channel.name} on ${message.guild.name}. Try starting one there with \`${PREFIX}start <gameId>\`.`);
			}
		} else if (command === 'crules' && message.guild && isPrivileged) {
			if (gameSession) {
				message.channel.send(`The rules of the game ${gameSession.game.name} are as follows:\n ${gameSession.game.rules(client.globalSettings, gameSession.settings)}\n\nFor additional commands, try \`${PREFIX}help\`.${(client.globalSettings.ignorePrefix ? `\nMessages starting with \`${client.globalSettings.ignorePrefix}\` will be ignored.` : '')}`);
			} else if (gameId) {
				const game = client.games.get(gameId);
				if (game) {
					message.channel.send(`The rules of the game ${game.name} are as follows:\n ${game.rules(client.globalSettings, client.gameSettings[gameId])}\n\nFor additional commands, try \`${PREFIX}help\`.${(client.globalSettings.ignorePrefix ? `\nMessages starting with \`${client.globalSettings.ignorePrefix}\` will be ignored.` : '')}`);
				} else {
					message.author.send(`There is no game **${gameId}**. Use \`${PREFIX}list\` in here to retrieve a list of available games.`);
				}
			}
		} else if (command === 'rules') {
			if (gameSession) {
				message.author.send(`I will gladly explain the rules of the game ${gameSession.game.name} in #${message.channel.name} on ${message.guild.name} to you:\n ${gameSession.game.rules(client.globalSettings, gameSession.settings)}\n\nFor additional commands, try \`${PREFIX}help\`.${(client.globalSettings.ignorePrefix ? `\nMessages starting with \`${client.globalSettings.ignorePrefix}\` will be ignored.` : '')}`);
			} else if (gameId) {
				const game = client.games.get(gameId);
				if (game) {
					message.author.send(`I will gladly explain the rules of the game ${game.name} to you:\n\n ${game.rules(client.globalSettings, client.gameSettings[gameId])}\n\nFor additional commands, try \`${PREFIX}help\`.${(client.globalSettings.ignorePrefix ? `\nMessages starting with \`${client.globalSettings.ignorePrefix}\` will be ignored.` : '')}`);
				} else {
					message.author.send(`There is no game **${gameId}**. Use \`${PREFIX}list\` in here to retrieve a list of available games.`);
				}
			} else if (message.guild) {
				message.author.send(`There is currently no game running in #${message.channel.name} on ${message.guild.name}. Try starting one in there with \`${PREFIX}start <gameId>\` or asking me here for the rules for a specific game with \`${PREFIX}rules <gameId>\`.`);
			} else {
				message.author.send(`You forgot to add the name of the game you wish to know the rules for. Use \`${PREFIX}list\` in here to retrieve a list of available games.`);
			}
		} else if (command === 'set' && message.guild && isPrivileged) {
			const [setting, value] = commandArgs.split(' ', 2);
			if (!gameSession) {
				message.author.send(`There is currently no game running in #${message.channel.name} on ${message.guild.name}.You can only change settings if there is a game running.`);
				message.react('🚫');
			} else if (!commandArgs.match(/^[A-Za-z0-9\-_.]+ [^<>\\]+$/g) || (!client.isOverridableSetting(setting) && gameSession.settings[setting] === undefined)) {
				message.author.send(`There is no setting of that name available in ${gameSession.game.name} (\`${gameSession.game.id}\`).`);
				message.react('🚫');
			} else if (client.validateOverridableSetting(setting, value)) {
				client.gameSessionLocks.acquire(gameSession.id, () => {
					message.author.send(`Setting ${setting} to ${value} for ${gameSession.game.name} (\`${gameSession.game.id}\`) in #${message.channel.name} on ${message.guild.name}.`);
					gameSession.settings[setting] = client.parseOverridableSetting(setting, value);
					client.storeGameSession(gameSession);
					message.react('⚙️');
				});
			} else if (gameSession.game.validateSetting(setting, value)) {
				client.gameSessionLocks.acquire(gameSession.id, () => {
					message.author.send(`Setting ${setting} to ${value} for ${gameSession.game.name} (\`${gameSession.game.id}\`) in #${message.channel.name} on ${message.guild.name}.`);
					gameSession.settings[setting] = gameSession.game.parseSetting(setting, value);
					client.storeGameSession(gameSession);
					message.react('⚙️');
				});
			} else {
				message.author.send(`The value you provided for setting ${setting} for ${gameSession.game.name} (\`${gameSession.game.id}\`) in #${message.channel.name} on ${message.guild.name} is invalid.`);
				message.react('🚫');
			}
		} else if (command === 'settings' && message.guild && isPrivileged && gameSession) {
			message.author.send(`Settings for ${gameSession.game.name} (\`${gameSession.game.id}\`) in #${message.channel.name} on ${message.guild.name}:\n\`${JSON.stringify(gameSession.settings, undefined, 4)}\``);
		} else {
			message.react('🚫');
			message.author.send(`The command \`${PREFIX}${command}\` is unknown or may exclusively be available for use in a channel or via DM.\nTry \`${PREFIX}help\` in here for a list of available commands.`);
		}
	} else if (gameSession && !(client.getEffectiveSettingValue('ignorePrefix', gameSession) && message.content.startsWith(client.getEffectiveSettingValue('ignorePrefix', gameSession)))) {
		await client.gameSessionLocks.acquire(message.channel.id, async () => {
			await gameSession.game.onMessage(client.globalSettings, gameSession.settings, gameSession.data, message);
			client.storeGameSession(gameSession);
		});
	}
});

client.on('messageReactionAdd', async (messageReaction) => {
	const gameSession = client.gameSessions.get(messageReaction.message.channel.id);
	if (gameSession && gameSession.restartVoteMessage && gameSession.restartVoteMessage.id === messageReaction.message.id && messageReaction.emoji.name === '👍') {
		const restartVoteCount = messageReaction.count - 1;
		client.globalSettings.debugMode && console.log('Restart vote received in', messageReaction.message.channel.name, 'on', messageReaction.message.guild.name, '. Current count:', restartVoteCount);
		if (restartVoteCount >= client.getEffectiveSettingValue('unprivilegedRestartVotes', gameSession)) {
			console.log(`Restarting the game ${gameSession.game.name} (${gameSession.id}) in channel ${messageReaction.message.channel.name} (${messageReaction.message.channel.id}) on ${messageReaction.message.guild.name} (${messageReaction.message.guild.id}).`);
			await gameSession.restartVoteMessage.react('🔄');
			await client.restartGame(gameSession);
			messageReaction.message.channel.send(`🔄 Restart vote successful! Restarting the game ${gameSession.game.name} in 3, 2, 1 …`);
		}
	}
});

client.on('messageReactionRemove', async (messageReaction) => {
	const gameSession = client.gameSessions.get(messageReaction.message.channel.id);
	if (gameSession && gameSession.restartVoteMessage && gameSession.restartVoteMessage.id === messageReaction.message.id && messageReaction.emoji.name === '👍') {
		const restartVoteCount = messageReaction.count - 1;
		client.globalSettings.debugMode && console.log('Restart vote retracted in', messageReaction.message.channel.name, 'on', messageReaction.message.guild.name, '. Current count:', restartVoteCount);
	}
});

client.on('messageUpdate', async (oldMessage, newMessage) => {
	const gameSession = client.gameSessions.get(oldMessage.channel.id);
	if (gameSession) {
		await client.gameSessionLocks.acquire(oldMessage.channel.id, async () => {
			await gameSession.game.onMessageUpdate(client.globalSettings, gameSession.settings, gameSession.data, oldMessage, newMessage);
			client.storeGameSession(gameSession);
		});
	}
});

client.on('messageDelete', async message => {
	const gameSession = client.gameSessions.get(message.channel.id);
	if (gameSession) {
		await client.gameSessionLocks.acquire(message.channel.id, async () => {
			await gameSession.game.onMessageDelete(client.globalSettings, gameSession.settings, gameSession.data, message);
			client.storeGameSession(gameSession);
		});
	}
});


(function () {
	const { globalSettings, gameSettings, token: TOKEN } = require('./config.json');
	client.globalSettings = globalSettings;
	client.gameSettings = gameSettings;
	client.gameSessions = new Discord.Collection();
	client.gameSessionLocks = new AsyncLock();

	client.loadGames();
	client.restoreGameSessions();
	client.login(TOKEN);
}());
