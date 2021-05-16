// TODO: Support for nodehun as alternative implementation
const nspell = require('nspell');
const axios = require('axios').default;

const hunspellDictionaries = {};
const httpDictionaries = {};

function parseDictionaryUrl(dictionaryUrl) {
	return {
		isHttp: (dictionaryUrl.startsWith('https://') || dictionaryUrl.startsWith('http://')) && dictionaryUrl.includes('%s'),
		isHunspell: dictionaryUrl.startsWith('hunspell://'),
		language: (dictionaryUrl.match(/^hunspell:\/\/([^/]*)$/) || [])[1],
		url: dictionaryUrl,
	};
}

async function isValidHunspell(dictionary, word) {
	return dictionary && dictionary.correct(word) || dictionary.suggest(word).findIndex(suggestion => suggestion.toLowerCase() == word) >= 0;
}

async function isValidHttp(dictionaryUrl, word) {
	return true && await axios.get(`${dictionaryUrl}`.replace('%s', word)).catch(console.error);
}

async function loadHttp(dictionaryInfo) {
	if (httpDictionaries[dictionaryInfo.url] === undefined) {
		httpDictionaries[dictionaryInfo.url] = {
			isValid: isValidHttp.bind(null, dictionaryInfo.url),
		};
	}
	return httpDictionaries[dictionaryInfo.language];
}

async function loadHunspell(dictionaryInfo) {
	let dictionary = hunspellDictionaries[dictionaryInfo.language];
	if (dictionary === undefined) {
		try {
			const dictionaryData = require(`dictionary-${dictionaryInfo.language}`);
			dictionary = await (new Promise(resolve => {
				dictionaryData((error, data) => {
					if (error) {
						throw error;
					}
					resolve(nspell(data));
				});
			}));
			dictionary.isValid = isValidHunspell.bind(null, dictionary);
			hunspellDictionaries[dictionaryInfo.language] = dictionary;
		} catch (error) {
			console.error('Failed to load dictionary for language "', dictionaryInfo.language, '": ', error);
		}
	}
	return dictionary;
}

module.exports = {
	load: async function (dictionaryUrl) {
		const dictionaryInfo = parseDictionaryUrl(dictionaryUrl);
		if (dictionaryInfo.isHttp) {
			return loadHttp(dictionaryInfo);
		} else if (dictionaryInfo.isHunspell && dictionaryInfo.language !== undefined) {
			return loadHunspell(dictionaryInfo);
		} else {
			console.error('Invalid dictionary:', dictionaryInfo);
			return undefined;
		}
	},
	isValid: async function (dictionaryUrl, word) {
		const dictionary = await this.load(dictionaryUrl);
		return dictionary && await dictionary.isValid(word);
	},
};