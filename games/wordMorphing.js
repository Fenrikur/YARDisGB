/*
	YARDisGB – Yet Another Random Discord Game Bot
	Copyright (C) 2020  Fenrikur <yardisgb [at] fenrikur.de>

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

const Discord = require('discord.js');
const utils = require('../utils.js');
const dictionaries = require('../dictionaries.js');
const { prefix: PREFIX } = require('../config.json');

const DIGITS = Object.freeze(['0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟']);
const MoveType = Object.freeze({
	repetition: { name: 'repetition', isSuccess: false },
	invalid: { name: 'invalid', isSuccess: false },
	edgeChange: { name: 'edgeChange', isSuccess: true },
	innerChange: { name: 'innerChange', isSuccess: true },
	edgeRemoval: { name: 'edgeRemoval', isSuccess: true },
	innerRemoval: { name: 'innerRemoval', isSuccess: true },
	edgeAddition: { name: 'edgeAddition', isSuccess: true },
	innerAddition: { name: 'innerAddition', isSuccess: true },
	firstWord: { name: 'firstWord', isSuccess: true },
});

function getSummary(data) {
	return `The game has been running for ${data.startTime ? utils.millisecondsToText(Date.now() - data.startTime) : 'an unknown period of time'} and all of you together managed to morph the starting word a total of ${Math.max(data.morphCount || 0, 0)} times!`;
}

function getScore(data) {
	if (data.score && data.score.size > 0) {
		let message = 'Here are the top contributors to the game session:';
		data.score.sort((a, b) => b.totalScore - a.totalScore);
		data.score.first(10).forEach((userScore, rank) => {
			message += `\n${rank + 1}. ${userScore.username} [${userScore.tag}] | 🧮: ${userScore.totalScore}`;
		});
		return message + '\n';
	} else {
		return 'There has been no activity during this game session.';
	}
}

function UserScore(user) {
	this.id = (user && user.id) ? user.id : 0;
	this.username = (user && user.username) ? user.username : '';
	this.tag = (user && user.tag) ? user.tag : '';
	this.totalScore = 0;
	this.statistics = Object.fromEntries(Object.keys(MoveType).map(moveType => [moveType, 0]));
}

function getUserScoreSuccessCount(userScore) {
	return Object.entries(userScore.statistics).map((entry) => MoveType[entry[0]].isSuccess ? entry[1] : 0).reduce((previousValue, currentValue) => previousValue + currentValue);
}

function getUserScoreFailureCount(userScore) {
	return Object.entries(userScore.statistics).map((entry) => !MoveType[entry[0]].isSuccess ? entry[1] : 0).reduce((previousValue, currentValue) => previousValue + currentValue);
}

function getUserScore(data, user) {
	if (!data.score) {
		return new UserScore();
	} else if (data.score.has(user.id)) {
		return data.score.get(user.id);
	} else {
		const userScore = new UserScore(user);
		data.score.set(user.id, userScore);
		return userScore;
	}
}

function doSessionStart(globalSettings, gameSettings, data, channel) {
	channel.send('Starting the game … please wait while we sort our vowels and consonants.\n… done.\nPlease provide a word to serve as the starting point for this session.');
}

function doSessionEnd(globalSettings, gameSettings, data, channel) {
	channel.send(getSummary(data));
	gameSettings.enableScore && channel.send(getScore(data));
}

module.exports = {
	id: 'wordMorphing',
	name: 'Word Morphing',
	rules: function (globalSettings, gameSettings) {
		return `\t- The previous accepted word may be morphed in one of three ways:\n\t\t- By adding a new letter,\n\t\t- by removing a letter or\n\t\t- by changing a letter.\n\t- Each new word must be a real word.\n\t- Recently used words may not be reused.\n\t${gameSettings.caseInsensitive ? '- Changes in case will be ignored.' : '- Changes will be case-sensitive.'}${gameSettings.dictionaryUrl ? '\n\t' + (gameSettings.enforceDictionary ? `- Words must verify successfully against the currently selected dictionary (\`${gameSettings.dictionaryUrl}\`).` : `- Words will be checked against currently selected dictionary (\`${gameSettings.dictionaryUrl}\`) and marked with 📖 for existing and 🚮 for unknown words.`) : ''}\n\n**Example:**\n\t1) start\n\t2) tart\n\t3) cart\n\n**Tip:** Reached a dead end? Feeling stuck? Feel free to \`${PREFIX}restart\` the game for a fresh start.`;
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
			doSessionStart(globalSettings, gameSettings, data, channel);
		} catch (error) {
			console.error('Failed to send message to channel!', channel);
		}
	},
	onEnd: function (globalSettings, gameSettings, data, channel) {
		try {
			doSessionEnd(globalSettings, gameSettings, data, channel);
			channel.send('It was fun while it lasted! Bye!');
		} catch (error) {
			console.error('Failed to send message to channel!', channel);
		}
	},
	onRestart: function (globalSettings, gameSettings, data, channel) {
		try {
			channel.send('So you got stuck, eh? Let\'s try this again!');
			doSessionEnd(globalSettings, gameSettings, data, channel);
			doSessionStart(globalSettings, gameSettings, data, channel);
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
		let moveType = false;
		let userScore = (gameSettings.enableScore && data.score) ? getUserScore(data, message.author) : false;

		if (/\s/g.test(messageContent)) {
			errorMessage = 'Only contiguous words are allowed in this game. Try again.';
			moveType = MoveType.invalid;
		} else if (!/^\p{General_Category=Letter}+$/gu.test(messageContent)) {
			errorMessage = 'Only letters are allowed. Try again.';
			moveType = MoveType.invalid;
		} else if (previousMessage === null) {
			message.react('1️⃣').catch(console.error);
			globalSettings.debugMode && console.log(`${message.channel.name} (${message.channel.id}): Set first word to '${messageContent}'`);
			moveType = MoveType.firstWord;
		} else if (!gameSettings.allowSameUser && message.author.id === previousMessage.author.id) {
			errorMessage = 'Don\'t just play with yourself, let the others participate as well!';
			moveType = MoveType.invalid;
		} else if (messageContent === previousMessageContent) {
			if (message.createdTimestamp - previousMessage.createdTimestamp < 1000) {
				message.react('🐌');
				errorMessage = true;
				moveType = false;
			} else {
				errorMessage = 'Simply repeating the current word is not going to get us anywhere, try coming up with something new!';
				moveType = MoveType.repetition;
			}
		} else if (gameSettings.wordHistoryLength > 0 && data.wordHistory.indexOf(messageContent) >= Math.max(0, data.wordHistory.length - gameSettings.wordHistoryLength)) {
			errorMessage = `Your new word **${messageContent}** has been used within the last ${gameSettings.wordHistoryLength} moves, try coming up with something new!`;
			moveType = MoveType.repetition;
		} else if (messageLength > previousMessageLength + 1) {
			errorMessage = `Your new word **${messageContent}** has more than one character more than the previous word!`;
			moveType = MoveType.invalid;
		} else if (messageLength < previousMessageLength - 1) {
			errorMessage = `Your new word **${messageContent}** has more than one character less than the previous word!`;
			moveType = MoveType.invalid;
		} else {
			let shortMessage = messageContent;
			let longMessage = previousMessageContent;
			const hasDifferentLength = messageLength !== previousMessageLength;
			const isAddition = messageLength > previousMessageLength;
			let isEdgeChange = true;
			if (isAddition) {
				shortMessage = previousMessageContent;
				longMessage = messageContent;
			}

			let diffCount = 0;
			for (let shortIndex = 0, longIndex = 0; ; shortIndex++, longIndex++) {
				const shortMessageChar = shortMessage.charCodeAt(shortIndex);
				const longMessageChar = longMessage.charCodeAt(longIndex);
				if (diffCount > 1) {
					errorMessage = `Your new word **${messageContent}** differs from the previous word in more than one letter!`;
					moveType = MoveType.invalid;
					break;
				} else if (!shortMessageChar && !longMessageChar) {
					break;
				} else if (shortMessageChar !== longMessageChar) {
					isEdgeChange = shortIndex == 0 || shortIndex >= shortMessage.length - 1;
					diffCount++;
					if (hasDifferentLength && shortMessageChar === longMessage.charCodeAt(longIndex + 1)) {
						longIndex++;
					} else {
						continue;
					}
				}
			}

			if (!errorMessage) {
				if (isAddition) {
					if (isEdgeChange) {
						moveType = MoveType.edgeAddition;
					} else {
						moveType = MoveType.innerAddition;
					}
				} else if (hasDifferentLength) {
					if (isEdgeChange) {
						moveType = MoveType.edgeRemoval;
					} else {
						moveType = MoveType.innerRemoval;
					}
				} else {
					if (isEdgeChange) {
						moveType = MoveType.edgeChange;
					} else {
						moveType = MoveType.innerChange;
					}
				}
			}
		}

		if (errorMessage) {
			message.react('❌').catch(console.error);
			if (errorMessage !== true) {
				message.reply(`${errorMessage}${previousMessage !== null ? ` The current word is still: **${previousMessage.content}**` : ''}`);
			}
		} else {
			if (gameSettings.dictionaryUrl) {
				const reaction = await message.react('🛃').catch(console.error);
				const isValid = await dictionaries.isValid(gameSettings.dictionaryUrl, messageContent);

				if (isValid) {
					if (gameSettings.enforceDictionary) {
						message.react('✅').catch(console.error);
						data.morphCount++;
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
					errorMessage = `We failed to find the word **${messageContent}** in the dictionary.`;
					if (gameSettings.enforceDictionary) {
						message.react('❌').catch(console.error);
						moveType = MoveType.invalid;
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
		if (userScore && moveType) {
			const scoreValue = gameSettings['scoreValue' + utils.capitalizeFirstLetter(moveType.name)] || 0;
			userScore.statistics[moveType.name]++;
			userScore.totalScore += scoreValue;
			message.react(scoreValue == 0 ? '➡️' : (scoreValue > 0 ? '⬆️' : '⬇️')).catch(console.error);
			message.react(DIGITS[Math.abs(scoreValue)]).catch(console.error);
		}
	},
	onMessageUpdate: function (globalSettings, gameSettings, data, oldMessage, newMessage) {
		const previousMessage = data.previousMessage;
		if (previousMessage && oldMessage.id === previousMessage.id && oldMessage.content === previousMessage.content) {
			newMessage.react('💢').catch(console.error);
			gameSettings.enableScore && data.score && getUserScore(data, oldMessage.author).failureCount++;
			newMessage.reply(`Editing your previous word after the fact is unfair! The current word is still: **${previousMessage.content}**`);
		}
	},
	onMessageDelete: function (globalSettings, gameSettings, data, message) {
		const previousMessage = data.previousMessage;
		if (previousMessage && message.id === previousMessage.id) {
			gameSettings.enableScore && data.score && getUserScore(data, message.author).failureCount++;
			message.channel.send(`<@${message.author.id}> deleting your previous word after the fact is unfair! The current word is still: **${previousMessage.content}**`);
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
			case 'scoreValueRepetition':
			case 'scoreValueInvalid':
			case 'scoreValueEdgeChange':
			case 'scoreValueInnerChange':
			case 'scoreValueEdgeRemoval':
			case 'scoreValueInnerRemoval':
			case 'scoreValueEdgeAddition':
			case 'scoreValueInnerAddition':
			case 'scoreValueFirstWord':
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
				return value.match(/^https:\/\/.*%s.*$/) || value.match(/^hunspell:\/\/[^/\\]+$/) || value === 'false';
			case 'enforceDictionary':
				return value === 'true' || value === 'false';
			case 'caseInsensitive':
				return value === 'true' || value === 'false';
			case 'enableScore':
				return value === 'true' || value === 'false';
			case 'scoreValueRepetition':
			case 'scoreValueInvalid':
			case 'scoreValueEdgeChange':
			case 'scoreValueInnerChange':
			case 'scoreValueEdgeRemoval':
			case 'scoreValueInnerRemoval':
			case 'scoreValueEdgeAddition':
			case 'scoreValueInnerAddition':
			case 'scoreValueFirstWord':
				return value.match(/^-?[0-9]+$/) && value >= -10 && value <= 10;
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
			case 'scoreValueRepetition':
			case 'scoreValueInvalid':
			case 'scoreValueEdgeChange':
			case 'scoreValueInnerChange':
			case 'scoreValueEdgeRemoval':
			case 'scoreValueInnerRemoval':
			case 'scoreValueEdgeAddition':
			case 'scoreValueInnerAddition':
			case 'scoreValueFirstWord':
				return Number.parseInt(value);
			default:
				return undefined;
		}
	},
};