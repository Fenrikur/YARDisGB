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

const axios = require('axios').default;
const Discord = require('discord.js');
const utils = require('../utils.js');
const { prefix: PREFIX } = require('../config.json');

function getSummary(data) {
	if (data.startTime === undefined || data.morphCount === undefined) {
		return '';
	}
	return `The game has been running for ${utils.millisecondsToText(Date.now() - data.startTime)} and all of you together managed to morph the starting word a total of ${Math.max(data.morphCount, 0)} times!`;
}

function getScore(data) {
	if (data.score && data.score.size > 0) {
		let message = 'Here are the top contributors to the game session:';
		data.score.sort((a, b) => (b.successCount - b.failureCount) - (a.successCount - a.failureCount));
		data.score.first(10).forEach((userScore, rank) => {
			message += `\n${rank + 1}. ${userScore.username} [${userScore.tag}] (✅: ${userScore.successCount} | ❌: ${userScore.failureCount} | 🧮: ${userScore.successCount - userScore.failureCount})`;
		});
		return message + '\n';
	} else {
		return '';
	}
}

function getUserScore(data, user) {
	if (!data.score) {
		return {
			id: 0,
			username: '',
			tag: '',
			successCount: 0,
			failureCount: 0,
		};
	} else if (data.score.has(user.id)) {
		return data.score.get(user.id);
	} else {
		const userScore = {
			id: user.id,
			username: user.username,
			tag: user.tag,
			successCount: 0,
			failureCount: 0,
		};
		data.score.set(user.id, userScore);
		return userScore;
	}
}

async function checkDictionary(dictionaryUrl, word) {
	let isValid = false;
	if (dictionaryUrl.startsWith('https://') || dictionaryUrl.startsWith('http://')) {
		isValid = true && await axios.get(`${dictionaryUrl}`.replace('%s', word)).catch(console.error);
	}
	return isValid;
}

module.exports = {
	id: 'wordMorphing',
	name: 'Word Morphing',
	rules: function (globalSettings, gameSettings) {
		return `\t- The previous accepted word may be morphed in one of three ways:\n\t\t- By adding a new letter,\n\t\t- by removing a letter or\n\t\t- by changing a letter.\n\t- Each new word must be a real word.\n\t- Recently used words may not be reused.\n\t${gameSettings.caseInsensitive ? '- Changes in case will be ignored.' : '- Changes will be case-sensitive.'}\n\nExample:\n\t1) start\n\t2) tart\n\t3) cart\n\nTip: Reached a dead end? Feeling stuck? Feel free to \`${PREFIX}restart\` the game for a fresh start.`;
	},
	score: function (globalSettings, gameSettings, data) {
		return `${getSummary(data)}${gameSettings.enableScore ? `\n${getScore(data)}` : ''}`;
	},
	start: function () {
		return {
			previousMessage: null,
			wordHistory: [],
			score: new Discord.Collection(),
			// the first word doesn't count as an actual word morph
			morphCount: -1,
			startTime: Date.now(),
		};
	},
	restoreData: function (data) {
		const score = new Discord.Collection();
		data.score && data.score.forEach(userScore => score.set(userScore.id, userScore));
		data.score = score;
		return data;
	},
	onStart: function (globalSettings, gameSettings, data, channel) {
		try {
			channel.send('Starting the game … please wait while we sort our vowels and consonants.');
		} catch (error) {
			console.error('Failed to send message to channel!', channel);
		}
	},
	onEnd: function (globalSettings, gameSettings, data, channel) {
		try {
			channel.send(getSummary(data));
			gameSettings.enableScore && channel.send(getScore(data));
			channel.send('It was fun while it lasted! Bye!');
		} catch (error) {
			console.error('Failed to send message to channel!', channel);
		}
	},
	onRestart: function (globalSettings, gameSettings, data, channel) {
		try {
			channel.send('So you got stuck, eh? Let\'s try this again!');
			channel.send(getSummary(data));
			gameSettings.enableScore && channel.send(getScore(data));
		} catch (error) {
			console.error('Failed to send message to channel!', channel);
		}
	},
	onMessage: async function (globalSettings, gameSettings, data, message) {
		const previousMessage = data.previousMessage;
		const previousMessageContent = previousMessage ? gameSettings.caseInsensitive ? previousMessage.content.toLowerCase() : previousMessage.content : '';
		const previousMessageLength = previousMessage ? [...previousMessageContent].length : 0;
		const messageContent = gameSettings.caseInsensitive ? message.content.toLowerCase() : message.content;
		const messageLength = [...messageContent].length;
		let errorMessage = false;

		if (!gameSettings.enableScore && data.score) {
			data.score = false;
		}

		if (/\s/g.test(messageContent)) {
			errorMessage = 'only contiguous words are allowed in this game. Try again.';
		} else if (!/^\p{General_Category=Letter}+$/gu.test(messageContent)) {
			errorMessage = 'only letters are allowed. Try again.';
		} else if (previousMessage === null) {
			message.react('1️⃣').catch(console.error);
			globalSettings.debugMode && console.log(`${message.channel.name} (${message.channel.id}): Set first word to '${messageContent}'`);
		} else if (!gameSettings.allowSameUser && message.author.id === previousMessage.author.id) {
			errorMessage = 'don\'t just play with yourself, let the others participate as well!';
		} else if (messageContent === previousMessageContent) {
			if (message.createdTimestamp - previousMessage.createdTimestamp < 1000) {
				message.react('🐌');
				errorMessage = true;
			} else {
				errorMessage = 'simply repeating the previous word is cheating, try coming up with something new!';
			}
		} else if (gameSettings.wordHistoryLength > 0 && data.wordHistory.indexOf(messageContent) >= Math.max(0, data.wordHistory.length - gameSettings.wordHistoryLength)) {
			errorMessage = 'simply repeating a recently used word is cheating, try coming up with something new!';
		} else if (messageLength > previousMessageLength + 1) {
			errorMessage = `your new word **${messageContent}** has more than one character more than the previous word!`;
		} else if (messageLength < previousMessageLength - 1) {
			errorMessage = `your new word **${messageContent}** has more than one character less than the previous word!`;
		} else {
			let shortMessage = messageContent;
			let longMessage = previousMessageContent;
			const hasDifferentLength = messageLength !== previousMessageLength;
			if (messageLength > previousMessageLength) {
				shortMessage = previousMessageContent;
				longMessage = messageContent;
			}

			let diffCount = 0;
			for (let shortIndex = 0, longIndex = 0; ; shortIndex++, longIndex++) {
				const shortMessageChar = shortMessage.charCodeAt(shortIndex);
				const longMessageChar = longMessage.charCodeAt(longIndex);
				if (diffCount > 1) {
					errorMessage = `your new word **${messageContent}** differs from the previous word in more than one letter!`;
					break;
				} else if (!shortMessageChar && !longMessageChar) {
					break;
				} else if (shortMessageChar !== longMessageChar) {
					diffCount++;
					if (hasDifferentLength && shortMessageChar === longMessage.charCodeAt(longIndex + 1)) {
						longIndex++;
					} else {
						continue;
					}
				}
			}
		}

		if (errorMessage) {
			message.react('❌').catch(console.error);
			gameSettings.enableScore && data.score && getUserScore(data, message.author).failureCount++;
			if (errorMessage !== true) {
				message.reply(`${errorMessage}${previousMessage !== null ? ` The current word is still: **${previousMessage.content}**` : ''}`);
			}
		} else {
			if (gameSettings.dictionaryUrl) {
				const reaction = await message.react('🛃').catch(console.error);
				const isValid = await checkDictionary(gameSettings.dictionaryUrl, messageContent);
				if (isValid) {
					if (gameSettings.enforceDictionary) {
						message.react('✅').catch(console.error);
						data.morphCount++;
						gameSettings.enableScore && data.score && getUserScore(data, message.author).successCount++;
						gameSettings.wordHistoryLength > 0 && data.wordHistory.push(messageContent);
						if (data.wordHistory.length > gameSettings.wordHistoryLength) {
							data.wordHistory = data.wordHistory.slice(data.wordHistory.length - gameSettings.wordHistoryLength);
						}
						data.previousMessage = {
							id: message.id,
							content: `${messageContent}`,
							author: message.author,
							createdTimestamp: message.createdTimestamp,
						};
						globalSettings.debugMode && console.log(data);
					} else {
						message.react('📖').catch(console.error);
					}
				} else {
					errorMessage = `we failed to find the word **${messageContent}** in the dictionary.`;
					if (gameSettings.enforceDictionary) {
						message.react('❌').catch(console.error);
						gameSettings.enableScore && data.score && getUserScore(data, message.author).failureCount++;
						if (previousMessage) {
							message.reply(`${errorMessage} The current word is still: **${previousMessage.content}**`);
						} else {
							message.reply(`${errorMessage} The next valid word will be the starting point of the game.`);
						}
					} else {
						message.react('🚮').catch(console.error);
						message.reply(`${errorMessage}\n(… but you're still allowed to use it.)`);
					}
				}
				reaction && reaction.remove().catch(reason => { globalSettings.debugMode && console.log('Failed to remove reaction:', reason); });
			}

			if (!gameSettings.dictionaryUrl || !gameSettings.enforceDictionary) {
				message.react('✅').catch(console.error);
				data.morphCount++;
				gameSettings.enableScore && data.score && getUserScore(data, message.author).successCount++;
				gameSettings.wordHistoryLength > 0 && data.wordHistory.push(messageContent);
				if (data.wordHistory.length > gameSettings.wordHistoryLength) {
					data.wordHistory = data.wordHistory.slice(data.wordHistory.length - gameSettings.wordHistoryLength);
				}
				data.previousMessage = {
					id: message.id,
					content: `${messageContent}`,
					author: message.author,
					createdTimestamp: message.createdTimestamp,
				};
			}
		}
	},
	onMessageUpdate: function (globalSettings, gameSettings, data, oldMessage, newMessage) {
		const previousMessage = data.previousMessage;
		if (previousMessage && oldMessage.id === previousMessage.id && oldMessage.content === previousMessage.content) {
			newMessage.react('💢').catch(console.error);
			gameSettings.enableScore && data.score && getUserScore(data, oldMessage.author).failureCount++;
			newMessage.reply(`editing your previous word after the fact is unfair! The current word is still: **${previousMessage.content}**`);
		}
	},
	onMessageDelete: function (globalSettings, gameSettings, data, message) {
		const previousMessage = data.previousMessage;
		if (previousMessage && message.id === previousMessage.id) {
			gameSettings.enableScore && data.score && getUserScore(data, message.author).failureCount++;
			message.reply(`deleting your previous word after the fact is unfair! The current word is still: **${previousMessage.content}**`);
		}
	},
	hasSetting: function (setting) {
		switch (setting) {
			case 'allowSameUser':
			case 'wordHistoryLength':
			case 'dictionaryUrl':
			case 'enforceDictionary':
			case 'caseInsensitive':
			case 'enableScore':
				return true;
			default:
				return false;
		}
	},
	validateSetting: function (setting, value) {
		if (!setting || !value) {
			return false;
		}

		switch (setting) {
			case 'allowSameUser':
				return value === 'true' || value === 'false';
			case 'wordHistoryLength':
				return value.match(/^[0-9]+$/) && value >= 0 && value <= 1000;
			case 'dictionaryUrl':
				return value.match(/^https:\/\/.*%s.*$/) || value === 'false';
			case 'enforceDictionary':
				return value === 'true' || value === 'false';
			case 'caseInsensitive':
				return value === 'true' || value === 'false';
			case 'enableScore':
				return value === 'true' || value === 'false';
			default:
				return false;
		}
	},
	parseSetting: function (setting, value) {
		if (!setting || !value || !this.validateSetting(setting, value)) {
			return undefined;
		}

		switch (setting) {
			case 'allowSameUser':
				return value === 'true';
			case 'wordHistoryLength':
				return Number.parseInt(value);
			case 'dictionaryUrl':
				return value === 'false' ? false : value;
			case 'enforceDictionary':
				return value === 'true';
			case 'caseInsensitive':
				return value === 'true';
			case 'enableScore':
				return value === 'true';
			default:
				return undefined;
		}
	},
};