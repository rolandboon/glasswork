# The bundled Node server. Build the bundle first: node scripts/bundle.mjs --outdir=bundle
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY bundle/ ./
USER node
EXPOSE 3000
# Readiness turns 503 as soon as shutdown begins.
HEALTHCHECK --interval=10s --timeout=2s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health/ready" || exit 1
# Exec form: node runs as PID 1 and receives SIGTERM from `docker stop` itself.
CMD ["node", "server.mjs"]
