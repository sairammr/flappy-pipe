# Flappy Pipe engine: poke, settle, tournaments, swap bot, guest faucet. Needs ENGINE_KEY + BOT_KEY.
FROM oven/bun:1.3-slim
WORKDIR /app
COPY package.json ./
RUN bun install --production
COPY index.ts quote.ts ./
CMD ["bun", "run", "index.ts"]
