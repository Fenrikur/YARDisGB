# YARDisGB – Yet Another Random Discord Game Bot

So yeah, I guess you managed to stumble upon this mess that I whipped up on a whim with the first library that Google threw at me when searching for [`discord bot api`](https://www.google.com/search?q=discord+bot+api), which in my case turned out to be [discord.js](http://discord.js.org) (ymmv), in an attempt to get comfortable with the Discord API.

't is but a simple bot for playing word games with a basic understanding of the terms 'privileged access' and 'multi-tenancy', but should be sufficient to have some fun with and – in theory – should be easily extendable with additional games. (Just create a copy of `wordMorphing.js` in `./games` and hack away!)

If you wish to have the bot on your own Discord server, you should consider deploying your own instance, since I haven't really gotten around to stress testing the thing on multiple servers with lots of messages going around (would be interested in results though, should you dare giving it a try).
Be aware, that every successful game action as well as some commands will result in the corresponding game session JSON file being updated on the disk, so there will likely be a lot of I/O going on if people start enjoying themselves (as much as one can find joy in morphing words and such, that is).

The bot has been written with the idea in mind, that clutter produced by its responses should be kept to a minimum.
It will therefore only reply to messages in the channel itself for things that are directly relevant to the game and all players.
All other information is either transported via reactions on the respective message or by sending a direct message (DM) to the respective user.

## Prerequisites

The bot has been developed using [node.js](https://nodejs.org/) v14.7.0 and an attempt to use as few dependencies as possible (at the time of writing, three dependencies resulting in 20 packages being installed by `npm`).
Additional packages may be added to improve the performance of `discord.js` and switching to `discord.js-light` may also be worth considering, although that will likely incur some implementation efforts (as would moving this thing to TypeScript, which would really be a nice improvement).

To get you started on how to set up a bot using your Discord account and such, as well as understanding a lot of the stuff going on, I did find this [Discord.js Guide](https://discordjs.guide/) quite helpful to get started with the whole thing (you may recognize some code snippets I may have reused from their examples).

On the individual Discord server itself, the bot only needs minimal permissions, with some of them being optional:

- `Send Messages`: We obviously need to be able to do that in order to interact with players.
- `Manage Messages` (optional): This is necessary for the bot to be able to remove its own reactions again, e.g. after finishing its dictionary check (🛃 will be replaced by 🚮/❌ upon failure or 📖/✅ upon success, depending on whether `enforceDictionary` is `true`/`false`).
- `Add Reactions`: Sometimes, a reaction says more than a thousand messages.

… and of course, you will need to allow the bot access the channels you'd like it to monitor, but you probably already knew that.

## Global Configuration

To configure your instance of the bot, please create a copy of the file `config.json.default` in the same directory and rename it to `config.json`.
It contains examples for all settings that are currently available, with the only mandatory change necessary to get you going being that it is missing a valid `token`, which you can obtain by following [this section of the guide](https://discordjs.guide/preparations/setting-up-a-bot-application.html#your-token).

Since JSON doesn't really allow for comments to be added, here's a brief summary of the available settings:

```js
{
	"prefix": "!", // prefix used by the bot to identify messages as commands it should react to
	"token": "", // your personal bot API token (keep it secret, keep it safe and sure as hell don't commit it to the repo, let alone push it to GitHub!)
	"globalSettings": { // section of settings not specific to any game, although some may be overridden for individual game sessions
		"gamesDir": "./games", // path to the directory containing the games
		"sessionsDir": "./sessions", // path in which the bot should store game session data
		"debugMode": false, // reduces the logging output (really needs to be worked on)
		"ignorePrefix": "OT:", // (optional) makes the bot ignore messages starting with this case-insensitive prefix
		"isPrivilegedRole": "Game Master", // name of the role by which privileged users will be identified
		"unprivilegedRestartVotes": 10, // number of votes required for an unprivileged restart (may be overridden per game session; 0 means no votes required, allowing everybody to restart the game as long as unprivilegedRestartVoteDurationSeconds > 0)
		"unprivilegedRestartVoteDurationSeconds": 180 // time after which a vote will be cancelled (may be overridden per game session; 0 means no unprivileged restarts are possible)
	},
	"gameSettings": { // section containing default settings for new game sessions
		// default settings for individual games go here; examples, see below
	}
}
```

## Commands

While all commands that use the correct prefix configured for the running instance of the bot will be processed by it across all channels it has read access to, only commands that directly affect the game played within a channel (like e.g. `start`, `stop` or `restart`) will actually produce output in the channel itself.
All other commands will result in a DM being sent to the author of the command message, with the result of the command being denoted via a reaction placed on the respective message in the channel.

The `help` command will tell you about (nearly) all commands available to you in the context you used it in.
This means that if you send a DM with it to the bot, it'll only tell you about the unprivileged commands, no matter your roles on any servers you're on.
To receive a list which also contains privileged commands, please use the command in the context of a server where you have the necessary role.

In order to be able to make changes to game session settings without restarting the bot, the command `set <setting> <value>` allows privileged users to change individual settings and `settings` allows them to retrieve the current settings for the respective session running in the channel.
Please be aware that playing around with these may break things in weird ways, since they have not been excessively well tested and using them incorrectly may even crash the bot or the universe or both, who knows.

## Starting the Bot

Now for the most complicated part: Getting the bot up and running!

Once you've checked out the repository and run `npm ci` (or `npm i` or even `npm up` if you're adventurous!), you may launch an instance of the bot using

```bash
node index.js
```

## Available Games

The number of games currently available is rather limited (one *\*cough\**), but more are in the works and everybody (yes, you, too) is invited to suggest (by creating an issue on GitHub) or implement (by creating a pull request on GitHub) new ones any time!

### Word Morphing (`wordMorphing`)

The basic rule of this game is very simple:
The next word may differ from the previous by only a single letter (added, removed or replaced).

There are, however, some additional (optional) constraints available, limiting after how many steps a word may be reused (`wordHistoryLength`) or whether it should be checked against a dictionary (`dictionaryUrl`) (and optionally rejected if that check fails (`enforceDictionary`)).
To keep the game more interesting, it is also possible to prevent a single player from doing multiple moves in a row (`allowSameUser`) and for whatever reason, there's also an option allowing "ship" and "Ship" to be considered different words (`caseInsensitive`).

There are two different types of dictionary supported by the game at the moment:

- online, HTTP-based dictionaries
- offline, hunspell-based dictionaries

For details on each, please see the following sections.

#### Online/HTTP Dictionaries

The online dictionary check works by sending an HTTP GET request to the URL provided in `dictionaryUrl`, replacing the sequence `%s` with the word to be checked.
If the response status code is anything but one from the 2xx category, the check is considered failed.

The default settings use the [English version of Wiktionary](https://en.wiktionary.org/) for this, but since Wiktionary includes words from across all contributed languages, your milage may vary.
It does work without an API key though (which doesn't mean you should overdo it), so it seemed like a good starting point.

Other dictionaries that might be useful, but require you to sign up and request an API key (for which there is currently no good way of providing it to the bot without it leaking to the public) are:

- Yandex Dictionary (<https://tech.yandex.com/dictionary/>),
- OwlBot (<https://owlbot.info/>)
- and others …
- A short list of some public dictionary APIs can be found at: <https://github.com/public-apis/public-apis#dictionaries>

#### Offline/hunspell Dictionaries

To decrease the time spent doing HTTP requests, it is also possible to use offline dictionaries with the bot, which also allows for a more refined selection of allowed words.
Support is currently limited to a single dictionary being active at a time and, since they're rather handy, only [wroom's dictionaries](https://github.com/wooorm/dictionaries) or any that provide an identical API and naming scheme (you could theoretically their MIT licensed template and provide your own (local) module as long as its name matches `/^dictionary-[a-z-]+$/`).

All of the 'officially' supported dictionaries are listed as optional peer dependencies in the `package.json` (not 100% sure this is the right way to do it, but … *shrugs*) and may be installed/provided at any time (e.g. via `npm i dictionary-en --no-save`) since they will be loaded on-demand.
While adding new dictionaries can be done while the bot is running, reloading or updating dictionaries that have already been loaded will require a restart of the instance.

In order to have the bot use an offline dictionary, simply set `dictionaryUrl` to an URL starting with `hunspell://` followed by the short-code of your preferred (and installed) dictionary (e.g. `en` for English ~> `hunspell://en`).

#### Word Morphing Configuration

```js
"wordMorphing": { // the one and only (not really ...)
	"allowSameUser": false, // should the same user be allowed to send multiple words consecutively? (recommended: false, since it's not much of a game with just one player, right?)
	"wordHistoryLength": 10, // how many recently used words should the bot remember for a session and prevent players from reusing? (0 allows immediate reuse)
	"dictionaryUrl": "https://en.wiktionary.org/wiki/%s", // URL used for validating words against a dictionary; %s will be replaced by the word in question; 2xx HTTP status codes are interpreted as valid words; to disable dictionary checks altogether, set this to false
	"enforceDictionary": true, // should the bot reject all words deemed invalid by the dictionary check?
	"caseInsensitive": true, // should This and this be considered different words?
	"enableScore": true, // should scores for individual players be kept? (might impact performance as session files get bigger with more players)
	// all scoreValue-Settings must be in the range [-10, 10] and represent the number of points awarded or deducted for the respective move type
	"scoreValueRepetition": 0, // repetition of a previously used word from the current word history
	"scoreValueInvalid": 0, // invalid move like e.g. more than one change, multiple words or illegal characters
	"scoreValueEdgeChange": 1, // change at the beginning or end of the current word
	"scoreValueInnerChange": 2, // change within the current word
	"scoreValueEdgeRemoval": 1, // removal of a character from the beginning or end of the current word
	"scoreValueInnerRemoval": 1, // removal of a character from within the current word
	"scoreValueEdgeAddition": 2, // addition of a character at the beginning or end of the current word
	"scoreValueInnerAddition": 3, // addition of a character within the current word
	"scoreValueFirstWord": 0 // first word of a game session
}
```

## (Experimental) Running the Bot in a Container

The [`Containerfile`](./Containerfile) provided with this repository can be used to run the bot (e.g. using a rootless `podman`) by running the following basic commands, assuming the global configuration is located in `/home/yardisgb/config/config.json`:

```bash
podman build -t yardisgb:latest .
podman create -l app=yardisgb -v=yardisgb-sessions:/var/yardisgb/sessions --mount=type=bind,source=/home/yardisgb/config,dst=/var/yardisgb/config,ro=true --name=yardisgb localhost/yardisgb:latest
podman start yardisgb
```
