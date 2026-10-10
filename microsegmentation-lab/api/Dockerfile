FROM node:22-alpine AS dependencies
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-alpine
# npm is needed to build dependencies, but not to run this API. Remove its
# global dependency tree from the final image so scanner findings in npm's
# CLI do not become part of the deployed service.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
ENV NODE_ENV=production
WORKDIR /app
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node src ./src
USER node
EXPOSE 3000
CMD ["node", "src/server.js"]
