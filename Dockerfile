FROM node:20-alpine

WORKDIR /app

# Copy package descriptors from server directory
COPY server/package*.json ./

# Install production dependencies
RUN npm ci --only=production || npm install --production

# Copy server application code
COPY server/ ./

EXPOSE 4000
ENV PORT=4000
ENV NODE_ENV=production

CMD ["node", "index.js"]
