// TODO: Support for nodehun as alternative implementation
const nspell = require('nspell');

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
}

const handler = {
	get: async function (target, language) {
		if (typeof target[language] === 'undefined') {
			await load(target, language);
		}

		return target[language];
	},
};

module.exports = new Proxy({}, handler);