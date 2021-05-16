// TODO: Support for nodehun as alternative implementation
const nspell = require('nspell');
const axios = require('axios').default;

const hunspellDictionaries = {};
const httpDictionaries = {};

function parseDictionaryUrl(dictionaryUrl) {
	return Object.defineProperties({}, {
		'isHttp': {
			value: (dictionaryUrl.startsWith('https://') || dictionaryUrl.startsWith('http://')) && dictionaryUrl.includes('%s'),
		},
		'isHunspell': {
			value: dictionaryUrl.startsWith('hunspell://'),
		},
		'language': {
			value: (dictionaryUrl.match(/^hunspell:\/\/([a-z-]+)$/) || [])[1],
		},
		'url': {
			value: dictionaryUrl,
		},
	});
}

async function isValidHunspell(word) {
	return this.correct(word) || this.suggest(word).findIndex(suggestion => suggestion.toLowerCase() == word) >= 0;
}

async function isValidHttp(word) {
	return true && await axios.get(`${this.info.url}`.replace('%s', word)).catch(console.error);
}

async function loadHttp(dictionaryInfo) {
	let dictionary = httpDictionaries[dictionaryInfo.url];
	if (dictionary === undefined) {
		dictionary = {};
		dictionary = Object.defineProperties(dictionary, {
			info: {
				value: dictionaryInfo,
			},
			isValid: {
				value: isValidHttp.bind(dictionary),
			},
		});
		httpDictionaries[dictionaryInfo.url] = dictionary;
	}
	return dictionary;
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
			Object.defineProperty(dictionary, 'info', {
				value: dictionaryInfo,
			});
			dictionary.isValid = isValidHunspell.bind(dictionary);
			hunspellDictionaries[dictionaryInfo.language] = dictionary;
		} catch (error) {
			console.error('Failed to load dictionary for language ', dictionaryInfo.language, ': ', error);
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