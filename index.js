/*
	YARDisGB – Yet Another Random Discord Game Bot
	Copyright (C) 2020 Fenrikur <yardisgb [at] fenrikur.de>

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
const utils = require('./utils.js');
const AsyncLock = require('async-lock');

const intents = new Discord.Intents([
	Discord.Intents.FLAGS.DIRECT_MESSAGES,
	Discord.Intents.FLAGS.DIRECT_MESSAGE_REACTIONS,
	Discord.Intents.FLAGS.GUILDS,
	Discord.Intents.FLAGS.GUILD_MESSAGES,
	Discord.Intents.FLAGS.GUILD_MESSAGE_REACTIONS,
]);
const client = new Discord.Client({
	intents: intents,
	partials: ['CHANNEL', 'MESSAGE', 'REACTION'],
});

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
		console.log(`Loading session in ${sessionsDir}/${file} …`);
		const gameSession = require(`${sessionsDir}/${file}`);
		const game = client.games.get(gameSession.game.id);
		if (game) {
			gameSession.game = game;
			if (game.restoreData) {
				gameSession.data = game.restoreData(gameSession.data);
			}
			gameSessions.set(gameSession.id, gameSession);
			console.log(`Restored session ${gameSession.id} of the game ${game.name} with id ${game.id}.`);
			console.debug('gameSession', gameSession);
		} else {
			console.log(`Failed to restore session ${gameSession.id} of the game ${gameSession.game.name} with id ${gameSession.game.id} as the game itself is missing.`);
		}
	}

	this.gameSessions = gameSessions;
};

client.storeGameSession = function (gameSession) {
	fs.writeFileSync(`${client.globalSettings.sessionsDir}/${gameSession.id}.json`, JSON.stringify(gameSession, (key, value) => key.startsWith('restartVote') ? null : value));
};

client.startGame = async function (gameId, sessionId, sessionSettings) {
	const game = client.games.get(gameId);
	const gameSession = {
		id: sessionId,
		game: game,
		data: game.start(),
		settings: Object.assign({}, game.defaultSettings, client.gameSettings[gameId], sessionSettings ? Object.fromEntries(Object.entries(sessionSettings).filter(entry => game.hasSetting(entry[0]) || client.isOverridableSetting(entry[0]))) : {}),
		restartVoteCount: 0,
		restartVoteMessage: null,
		restartVoteTimeout: null,
	};
	const channel = await client.channels.fetch(gameSession.id, true);
	client.gameSessions.set(gameSession.id, gameSession);
	channel.send(`Starting the game ${gameSession.game.name}! Use \`${PREFIX}rules\` if you want to know the rules.`);
	gameSession.game.onStart && await gameSession.game.onStart(client.globalSettings, gameSession.settings, gameSession.data, channel);
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
		client.startGame(gameSession.game.id, gameSession.id, gameSession.settings);
	});
};

client.startRestartVote = async function (gameSession, message) {
	await client.gameSessionLocks.acquire(gameSession.id, async () => {
		const voteDurationSeconds = client.getEffectiveSettingValue('unprivilegedRestartVoteDurationSeconds', gameSession);
		// Maximum applicable duration for setTimeout() is 2147483647 (max value for signed 32-bit integer).
		const voteDurationMilliseconds = voteDurationSeconds * 1000 > 2147483647 ? 2147483647 : voteDurationSeconds * 1000;
		const voteMessage = await message.channel.send({
			content: `<@${message.author.id}> requested to restart the game. Their request requires ${client.getEffectiveSettingValue('unprivilegedRestartVotes', gameSession)} votes to succeed. Everybody who wishes to support it can vote by reacting to this message with 👍. Voting will be open for the next ${utils.millisecondsToText(voteDurationMilliseconds)}.`,
			allowedMentions: { parse: ['users'] },
		});
		voteMessage.react('👍').catch(console.error);
		gameSession.restartVoteMessage = voteMessage;
		gameSession.restartVoteTimeout = setTimeout(async (voteGameSession) => {
			try {
				await voteMessage.reactions.removeAll();
			} catch (reason) {
				client.globalSettings.debugMode && console.log('Failed to remove reactions:', reason);
			}
			voteMessage.react('🚫').catch(console.error);
			await client.clearRestartVote(voteGameSession);
		}, voteDurationMilliseconds, gameSession);
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
	client.user.setActivity('🐺🐺🐺🌕', { type: 'WATCHING' });
	console.log('Ready!');
});

client.on('messageCreate', async message => {
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
			message.author.send(`The following commands are available:\n\t- \`${PREFIX}help\`: (DM/Channel) Might provide more commands when used in a channel on a server where you have privileges.\n\t- \`${PREFIX}list\`: (DM) Receive a list of all available games via DM.\n\t- \`${PREFIX}rules\`: (Channel) Get the rules for the game currently running in the channel.\n\t- \`${PREFIX}rules <gameId>\`: (DM) Get the rules for a specific game.\n\t- \`${PREFIX}restart\`: (Channel) Initiate a vote to restart the game currently running in a channel.\n\t- \`${PREFIX}score\`: (Channel) Get the scores for the current game session via DM.\n\t- \`${PREFIX}myscore\`: (Channel) Get a detailed listing of how you've done so far in the current game session via DM.${isPrivileged ? `\n\nThe following commands are only available to *privileged users* and require a special role on the respective server:\n\t- \`${PREFIX}start <gameId>\`: (Channel) Start a new game in a channel.\n\t- \`${PREFIX}stop\`: (Channel) Stop the game currently running in a channel.\n\t- \`${PREFIX}restart now\`: (Channel) Immediately restart the game currently running in a channel.\n\t- \`${PREFIX}crules\`: (Channel) Output the rules of the currently running game to the channel.\n\t- \`${PREFIX}cscore\`: (Channel) Output the scores for the current game session to the channel.\n\t- \`${PREFIX}userscore <userId|userTag>\`: (Channel) Get the detailed scores for the specified or all users in the current game session via DM.` : ''}\n\nYou can find my code at: https://github.com/Fenrikur/YARDisGB`);
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
					message.react('🎬').catch(console.error);
				}
			}
		} else if (command === 'restart' && message.guild) {
			if (gameSession) {
				if ((isPrivileged && commandArgs === 'now') || (client.getEffectiveSettingValue('unprivilegedRestartVotes', gameSession) === 0 && client.getEffectiveSettingValue('unprivilegedRestartVoteDurationSeconds', gameSession) > 0)) {
					console.log(`Restarting the game ${gameSession.game.name} (\`${gameSession.game.id}\`) in channel ${message.channel.name} (${message.channel.id}) on ${message.guild.name} (${message.guild.id}).`);
					await message.react('🔄').catch(console.error);
					message.channel.send(`🔄 Restarting the game ${gameSession.game.name} in 3, 2, 1 …`);
					await client.restartGame(gameSession);
				} else if (client.getEffectiveSettingValue('unprivilegedRestartVoteDurationSeconds', gameSession) > 0 && client.getEffectiveSettingValue('unprivilegedRestartVotes', gameSession) > 0) {
					if (gameSession.restartVoteMessage) {
						message.author.send(`There is already a restart vote running in #${message.channel.name} on ${message.guild.name}. Please participate in this vote instead of trying to start a new one.`);
					} else {
						client.startRestartVote(gameSession, message);
					}
				} else {
					message.react('🚫').catch(console.error);
				}
			} else {
				message.author.send(`There is currently no game running in #${message.channel.name} on ${message.guild.name}. Try starting one there with \`${PREFIX}start <gameId>\`.`);
			}
		} else if (command === 'stop' && message.guild && isPrivileged) {
			if (gameSession) {
				console.log(`Ending the game ${gameSession.game.name} (\`${gameSession.game.id}\`) in channel ${message.channel.name} (${message.channel.id})`);
				await client.stopGame(gameSession);
				message.react('🏁').catch(console.error);
			} else {
				message.author.send(`There is currently no game running in #${message.channel.name} on ${message.guild.name}. Try starting one there with \`${PREFIX}start <gameId>\`.`);
			}
		} else if (command === 'crules' && message.guild && isPrivileged) {
			if (gameSession) {
				message.channel.send(`The rules of the game **${gameSession.game.name}** are as follows:\n ${gameSession.game.rules(client.globalSettings, gameSession.settings)}\n\nFor additional commands, try \`${PREFIX}help\`.${(client.globalSettings.ignorePrefix ? `\nMessages starting with \`${client.globalSettings.ignorePrefix}\` will be ignored.` : '')}`);
			} else if (gameId) {
				const game = client.games.get(gameId);
				if (game) {
					message.channel.send(`The rules of the game **${game.name}** are as follows:\n ${game.rules(client.globalSettings, client.gameSettings[gameId])}\n\nFor additional commands, try \`${PREFIX}help\`.${(client.globalSettings.ignorePrefix ? `\nMessages starting with \`${client.globalSettings.ignorePrefix}\` will be ignored.` : '')}`);
				} else {
					message.author.send(`There is no game with id \`${gameId}\`. Use \`${PREFIX}list\` in here to retrieve a list of available games.`);
				}
			}
		} else if (command === 'rules') {
			if (gameSession) {
				message.author.send(`I will gladly explain the rules of the game **${gameSession.game.name}** in #${message.channel.name} on ${message.guild.name} to you:\n ${gameSession.game.rules(client.globalSettings, gameSession.settings)}\n\nFor additional commands, try \`${PREFIX}help\`.${(client.globalSettings.ignorePrefix ? `\nMessages starting with \`${client.globalSettings.ignorePrefix}\` will be ignored.` : '')}`);
			} else if (gameId) {
				const game = client.games.get(gameId);
				if (game) {
					message.author.send(`I will gladly explain the rules of the game **${game.name}** to you:\n\n ${game.rules(client.globalSettings, client.gameSettings[gameId])}\n\nFor additional commands, try \`${PREFIX}help\`.${(client.globalSettings.ignorePrefix ? `\nMessages starting with \`${client.globalSettings.ignorePrefix}\` will be ignored.` : '')}`);
				} else {
					message.author.send(`There is no game with id \`${gameId}\`. Use \`${PREFIX}list\` in here to retrieve a list of available games.`);
				}
			} else if (message.guild) {
				message.author.send(`There is currently no game running in #${message.channel.name} on ${message.guild.name}. Try ${isPrivileged ? `starting one in there with \`${PREFIX}start <gameId>\` or ` : ''}asking me here for the rules for a specific game with \`${PREFIX}rules <gameId>\`.`);
			} else {
				message.author.send(`You forgot to add the name of the game you wish to know the rules for. Use \`${PREFIX}list\` in here to retrieve a list of available games.`);
			}
		} else if (command === 'set' && message.guild && isPrivileged) {
			const [setting, value] = commandArgs.split(' ', 2);
			if (!gameSession) {
				message.author.send(`There is currently no game running in #${message.channel.name} on ${message.guild.name}. You can only change settings if there is a game running.`);
				message.react('🚫').catch(console.error);
			} else if (!commandArgs.match(/^[A-Za-z0-9\-_.]+ [^<>\\]+$/g) || (!client.isOverridableSetting(setting) && !gameSession.game.hasSetting(setting))) {
				message.author.send(`There is no setting \`${setting}\` available in ${gameSession.game.name} (\`${gameSession.game.id}\`).`);
				message.react('🚫').catch(console.error);
			} else if (client.validateOverridableSetting(setting, value)) {
				client.gameSessionLocks.acquire(gameSession.id, () => {
					message.author.send(`Setting \`${setting}\` (override) to \`${value}\` for ${gameSession.game.name} (\`${gameSession.game.id}\`) in #${message.channel.name} on ${message.guild.name}.`);
					gameSession.settings[setting] = client.parseOverridableSetting(setting, value);
					client.storeGameSession(gameSession);
					message.react('⚙️').catch(console.error);
				});
			} else if (gameSession.game.validateSetting(setting, value)) {
				client.gameSessionLocks.acquire(gameSession.id, () => {
					message.author.send(`Setting \`${setting}\` (game) to ${value} for ${gameSession.game.name} (\`${gameSession.game.id}\`) in #${message.channel.name} on ${message.guild.name}.`);
					gameSession.settings[setting] = gameSession.game.parseSetting(setting, value);
					client.storeGameSession(gameSession);
					message.react('⚙️').catch(console.error);
				});
			} else {
				message.author.send(`The value \`${value}\` for setting \`${setting}\` for ${gameSession.game.name} (\`${gameSession.game.id}\`) in #${message.channel.name} on ${message.guild.name} is invalid.`);
				message.react('🚫').catch(console.error);
			}
		} else if (command === 'settings' && message.guild && isPrivileged && gameSession) {
			message.author.send(`Settings for ${gameSession.game.name} (\`${gameSession.game.id}\`) in #${message.channel.name} on ${message.guild.name}:\n\`${JSON.stringify(gameSession.settings, undefined, 4)}\``);
		} else if (command === 'cscore' && message.guild && isPrivileged && gameSession) {
			message.channel.send(gameSession.game.score(client.globalSettings, gameSession.settings, gameSession.data));
		} else if (command === 'score' && message.guild && gameSession) {
			message.author.send(`Current score for the game ${gameSession.game.name} in #${message.channel.name} on ${message.guild.name}:\n${gameSession.game.score(client.globalSettings, gameSession.settings, gameSession.data)}`);
		} else if (command === 'myscore' && message.guild && gameSession) {
			if (!gameSession.settings.enableScore) {
				message.author.send(`Unable to show your detailed score for the game ${gameSession.game.name} in #${message.channel.name} on ${message.guild.name}, because scoring has been disabled for this game session.`);
			} else {
				message.author.send(`Here is your detailed score for the game ${gameSession.game.name} in #${message.channel.name} on ${message.guild.name}:\n${gameSession.game.userScore(client.globalSettings, gameSession.settings, gameSession.data, message.author, isPrivileged)}`);
			}
		} else if (command === 'userscore' && message.guild && isPrivileged && gameSession) {
			if (!gameSession.settings.enableScore) {
				message.author.send(`Unable to show detailed user scores for the game ${gameSession.game.name} in #${message.channel.name} on ${message.guild.name}, because scoring has been disabled for this game session.`);
			} else {
				message.author.send(`Here is the detailed score for ${commandArgs ? `user \`${commandArgs}\`` : 'all users'} for the game ${gameSession.game.name} in #${message.channel.name} on ${message.guild.name}:\n${gameSession.game.userScore(client.globalSettings, gameSession.settings, gameSession.data, { id: commandArgs, tag: commandArgs }, isPrivileged)}`);
			}
		} else {
			message.react('🚫').catch(console.error);
			message.author.send(`The command \`${PREFIX}${command}\` is unknown or may exclusively be available for use in a channel or via DM.\nTry \`${PREFIX}help\` in here for a list of available commands.`);
		}
		setTimeout((targetMessage) => { targetMessage.deletable && targetMessage.delete().catch(console.error); }, 3000, message);
	} else if (gameSession && !(client.getEffectiveSettingValue('ignorePrefix', gameSession) && message.content.toLowerCase().startsWith(client.getEffectiveSettingValue('ignorePrefix', gameSession).toLowerCase()))) {
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
			await gameSession.restartVoteMessage.react('🔄').catch(console.error);
			messageReaction.message.channel.send(`🔄 Restart vote successful! Restarting the game ${gameSession.game.name} in 3, 2, 1 …`);
			await client.restartGame(gameSession);
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
