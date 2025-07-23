#https://hub.docker.com/_/node/
#https://github.com/GoogleContainerTools/distroless/blob/main/README.md
FROM node:23.5.0-alpine3.20 AS build
WORKDIR /wikiless
COPY . /wikiless
RUN npm install --omit=optional
FROM gcr.io/distroless/nodejs22-debian11
COPY --from=build /wikiless /wikiless
WORKDIR /wikiless
COPY wikiless.config config.js
CMD ["src/wikiless.js"]
