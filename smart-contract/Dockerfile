FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY hardhat.config.js ./
COPY contracts ./contracts
COPY scripts ./scripts
RUN npx hardhat compile
CMD ["node", "scripts/docker-deploy.js"]
