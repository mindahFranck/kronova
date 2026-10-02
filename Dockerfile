FROM node:22-bookworm-slim

# zip : empaquetage de l'extension navigateur pendant le build
RUN apt-get update \
  && apt-get install -y --no-install-recommends zip ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build && mkdir -p data && chown -R node:node data

ENV NODE_ENV=production \
    PORT=3000 \
    TRUST_PROXY=true
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
USER node
CMD ["npx", "tsx", "server.ts"]
