const { UTF8_LETTERS_REGEX } = require('../util');
const https = require('https');

module.exports = {
	name: 'Word Morphing',
	rules: function(settings) {
		return `\t- The previous accepted word may be morphed in one of three ways:\n\t\t- By adding a new letter,\n\t\t- by removing a letter or\n\t\t- by changing a letter.\n\t- Each new word must be a real word.\n\t- Recently used words may not be reused.\n\t${settings.caseInsensitive ? '- Changes in case will be ignored.' : '- Changes will be case-sensitive.'}\n\nExample:\n\t1) start\n\t2) tart\n\t3) cart`;
	},
	start: function() {
		return {
			previousMessage: null,
			wordHistory: [],
		};
	},
	onMessage: function(settings, data, message) {
		const previousMessage = data.previousMessage;
		const previousMessageContent = previousMessage ? settings.caseInsensitive ? previousMessage.content.toLowerCase() : previousMessage.content : '';
		const previousMessageLength = previousMessage ? [...previousMessageContent].length : 0;
		const messageContent = settings.caseInsensitive ? message.content.toLowerCase() : message.content;
		const messageLength = [...messageContent].length;
		let errorMessage = null;

		if (previousMessage === null) {
			message.react('1️⃣');
			console.log(`${message.channel.name} (${message.channel.id}): Set first word to '${message.content}'`);
		} else if (/\s/g.test(messageContent)) {
			errorMessage = 'only contiguous words are allowed in this game. Try again.';
		} else if (UTF8_LETTERS_REGEX.test(messageContent)) {
			errorMessage = 'only letters are allowed. Try again.';
		} else if (!settings.allowSameUser && message.author.id === previousMessage.author.id) {
			errorMessage = 'don\'t play with yourself!';
		} else if (messageContent === previousMessageContent) {
			errorMessage = 'simply repeating the previous word is cheating!';
		} else if (data.wordHistory.indexOf(messageContent) >= 0) {
			errorMessage = 'simply repeating a recently used word is cheating!';
		} else if (messageLength > previousMessageLength + 1) {
			errorMessage = 'your new word has more than one character more than the previous word!';
		} else if (messageLength < previousMessageLength - 1) {
			errorMessage = 'your new word has more than one character less than the previous word!';
		} else {
			let shortMessage = messageContent;
			let longMessage = previousMessageContent;
			if (messageLength > previousMessageLength) {
				shortMessage = previousMessageContent;
				longMessage = messageContent;
			}

			let diffCount = 0;
			for (let shortIndex = 0, longIndex = 0;; shortIndex++, longIndex++) {
				const shortMessageChar = shortMessage.charCodeAt(shortIndex);
				const longMessageChar = longMessage.charCodeAt(longIndex);
				if (diffCount > 1) {
					errorMessage = 'your new word differs from the previous word in more than one letter!';
					break;
				} else if (!shortMessageChar && !longMessageChar) {
					break;
				} else if (shortMessageChar !== longMessageChar) {
					diffCount++;
					if (shortMessageChar === longMessage.charCodeAt(longIndex + 1)) {
						longIndex++;
					} else {
						continue;
					}
				}
			}
		}

		if (errorMessage) {
			message.react('❌');
			message.reply(`${errorMessage} The current word is still: **${previousMessage.content}**`);
		} else {
			if (settings.dictionaryUrl && !errorMessage) {
				message.react('🛃').then(reaction => {
					https.get(`${settings.dictionaryUrl}`.replace('%s', messageContent), (res) => {
						const { statusCode } = res;
						reaction.remove().catch(reason => { console.log('Failed to remove reaction:', reason); });
						console.log(res);
						if (statusCode !== 200) {
							errorMessage = `we failed to find the word **${message.content}** in the dictionary.`;
							if (settings.enforceDictionary) {
								message.react('❌');
								if (previousMessage) {
									message.reply(`${errorMessage} The current word is still: **${previousMessage.content}**`);
								} else {
									message.reply(`${errorMessage} The next valid word will be the starting point of the game.`);
								}
							} else {
								message.react('🚮');
								message.reply(`${errorMessage}\n(… but you're still allowed to use it.)`);
							}
						} else {
							message.react('✅');
							data.wordHistory.push(messageContent);
							if (data.wordHistory.length > settings.wordHistoryLength) {
								data.wordHistory.shift();
							}
							data.previousMessage = {
								id: message.id,
								content: `${message.content}`,
								author: message.author,
							};
							console.log(data);
						}
					});
				});
			}

			if (!settings.enforceDictionary) {
				message.react('☑️');
				data.wordHistory.push(message.content);
				if (data.wordHistory.length > settings.wordHistoryLength) {
					data.wordHistory.shift();
				}
				data.previousMessage = {
					id: message.id,
					content: `${message.content}`,
					author: message.author,
				};
			}
		}
	},
	onMessageUpdate: function(settings, data, oldMessage, newMessage) {
		const previousMessage = data.previousMessage;
		if (previousMessage && oldMessage.id === previousMessage.id && oldMessage.content === previousMessage.content) {
			newMessage.react('💢');
			newMessage.reply(`editing your previous word after the fact is unfair! The current word is still: **${previousMessage.content}**`);
		}
	},
	onMessageDelete: function(settings, data, message) {
		const previousMessage = data.previousMessage;
		if (previousMessage && message.id === previousMessage.id) {
			message.reply(`deleting your previous word after the fact is unfair! The current word is still: **${previousMessage.content}**`);
		}
	},
};