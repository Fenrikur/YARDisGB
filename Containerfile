FROM docker.io/node:16-alpine

VOLUME [ "/var/yardisgb/config", "/var/yardisgb/sessions" ]
RUN ln -s /var/yardisgb/config/config.json /home/node/config.json && \
	ln -s /var/yardisgb/sessions /home/node/sessions

WORKDIR /home/node
ADD --chown=1000:1000 ["*.js", "package.json", "package-lock.json", "/home/node/"]
ADD --chown=1000:1000 ["games", "/home/node/games"]
RUN npm ci --verbose && npm i --verbose --no-save dictionary-en dictionary-fr dictionary-de

USER 1000

CMD [ "node", "index.js"]