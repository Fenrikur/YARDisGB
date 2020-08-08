YARDisGB – Yet Another Random Discord Game Bot
===

So yeah, I guess you managed to stumble upon this mess that I whipped up on a whim with the first library that Google threw at me when searching for [`discord bot api`](https://www.google.com/search?q=discord+bot+api), which in my case turned out to be [discord.js](http://discord.js.org) (ymmv), in an attempt to get comfortable with the Discord API.

't is but a simple bot for playing word games with a basic understanding of the terms 'privileged access' and 'multi-tenancy', but should be sufficient to have some fun with and – in theory – should be easily extendable with additional games. (Just create a copy of `wordMorphing.js` in `./games` and hack away!)

If you wish to have the bot on your own Discord server, you should consider deploying your own instance, since I haven't really gotten around to stress testing the thing on multiple servers with lots of messages going around (would be interested in results though, should you dare giving it a try).
Be aware, that every successful game action as well as some commands will result in the corresponding game session JSON file being updated on the disk, so there will likely be a lot of I/O going on if people start enjoying themselves (as much as one can find joy in morphing words and such, that is).

The bot has been written with the idea in mind, that clutter produced by its responses should be kept to a minimum.
It will therefore only reply to messages in the channel itself for things that are directly relevant to the game and all players.
All other information is either transported via reactions on the respective message or by sending a direct message (DM) to the respective user.

Prerequisites
---

The bot has been developed using [node.js](https://nodejs.org/) v14.7.0 and an attempt to use as few dependencies as possible (at the time of writing, three dependencies resulting in 20 packages being installed by `npm`).
Additional packages may be added to improve the performance of `discord.js` and switching to `discord.js-light` may also be worth considering, although that will likely incur some implementation efforts (as would moving this thing to TypeScript, which would really be a nice improvement).

To get you started on how to set up a bot using your Discord account and such, as well as understanding a lot of the stuff going on, I did find this [Discord.js Guide](https://discordjs.guide/) quite helpful to get started with the whole thing (you may recognize some code snippets I may have reused from their examples).

On the individual Discord server itself, the bot only needs minimal permissions, with some of them being optional:

- `Send Messages`: We obviously need to be able to do that in order to interact with players.
- `Manage Messages` (optional): This is necessary for the bot to be able to remove its own reactions again, e.g. after finishing its dictionary check (🛃 will be replaced by 🚮/❌ upon failure or 📖/✅ upon success, depending on whether `enforceDictionary` is `true`/`false`).
- `Add Reactions`: Sometimes, a reaction says more than a thousand messages.

… and of course, you will need to allow the bot access the channels you'd like it to monitor, but you probably already knew that.

Configuration
---

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
		"isPrivilegedRole": "Game Master", // name of the role by which privileged users will be identified
		"unprivilegedRestartVotes": 10, // number of votes required for an unprivileged restart (may be overridden per game session; 0 means no votes required, allowing everybody to restart the game as long as unprivilegedRestartVoteDurationSeconds > 0)
		"unprivilegedRestartVoteDurationSeconds": 180 // time after which a vote will be cancelled (may be overridden per game session; 0 means no unprivileged restarts are possible)
	},
	"gameSettings": { // section containing default settings for new game sessions
		"wordMorphing": { // the one and only (not really ...)
			"allowSameUser": false, // should the same user be allowed to send multiple words consecutively? (recommended: false, since it's not much of a game with just one player, right?)
			"wordHistoryLength": 10, // how many recently used words should the bot remember for a session and prevent players from reusing? (0 allows immediate reuse)
			"dictionaryUrl": "https://en.wiktionary.org/wiki/%s", // URL used for validating words against a dictionary; %s will be replaced by the word in question; 20xx HTTP status codes are interpreted as valid words; to disable dictionary checks altogether, set this to false
			"enforceDictionary": true, // should the bot reject all words deemed invalid by the dictionary check?
			"caseInsensitive": true // should This and this be considered different words?
		}
	}
}
```

Commands
---

While all commands that use the correct prefix configured for the running instance of the bot will be processed by it across all channels it has read access to, only commands that directly affect the game played within a channel (like e.g. `start`, `stop` or `restart`) will actually produce output in the channel itself.
All other commands will result in a DM being sent to the author of the command message, with the result of the command being denoted via a reaction placed on the respective message in the channel.

The `help` command will tell you about (nearly) all commands available to you in the context you used it in. 
This means that if you send a DM with it to the bot, it'll only tell you about the unprivileged commands, no matter your roles on any servers you're on.
To receive a list which also contains privileged commands, please use the command in the context of a server where you have the necessary role.

In order to be able to make changes to game session settings without restarting the bot, the command `set <setting> <value>` allows privileged users to change individual settings and `settings` allows them to retrieve the current settings for the respective session running in the channel.
Please be aware that playing around with these may break things in weird ways, since they have not been excessively well tested and using them incorrectly may even crash the bot or the universe or both, who knows.

Starting the Bot
---

Now for the most complicated part: Getting the bot up and running!

Once you've checked out the repository and run `npm ci` (or `npm i` or even `npm up` if you're adventurous!), you may launch an instance of the bot using
```
node index.js
```
