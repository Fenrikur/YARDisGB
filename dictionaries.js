// TODO: Support for nodehun as alternative implementation
const nspell = require('nspell');
const axios = require('axios').default;

async function load(target, language) {
	try {
		const dictionary = require(`dictionary-${language}`);
		target[language] = await (new Promise(resolve => {
			dictionary((error, data) => {
				if (error) {
					throw error;
				}
				resolve(nspell(data));
			});
		}));
	} catch (error) {
		target[language] = false;
		console.error('Failed to load dictionary for language "', language, '": ', error);
	}
	return target[language];
}

async function isValid(receiver, dictionaryUrl, word) {
	let result = false;
	if (dictionaryUrl.startsWith('https://') || dictionaryUrl.startsWith('http://')) {
		result = true && await axios.get(`${dictionaryUrl}`.replace('%s', word)).catch(console.error);
	} else {
		const language = (dictionaryUrl.match(/^dictionary:\/\/(.*)$/) || [])[1];
		const dictionary = await receiver[language];
		result = dictionary && dictionary.correct(word) || dictionary.suggest(word).findIndex(suggestion => suggestion.toLowerCase() == word) >= 0;
	}
	return result;
}

const handler = {
	get: function (target, property, receiver) {
		if (property === 'isValid') {
			return isValid.bind(target, receiver);
		}

		if (typeof target[property] === 'undefined') {
			return new Promise(resolve => resolve(load(target, property)));
		}

		return new Promise(resolve => resolve(target[property]));
	},
};

module.exports = new Proxy({}, handler);