FROM node:22-alpine

WORKDIR /app

# Copy package descriptors
COPY package*.json ./

# Install production dependencies
RUN npm ci --omit=dev || npm install --omit=dev

# Copy server code
COPY . .

EXPOSE 4000
ENV PORT=4000
ENV NODE_ENV=production

CMD ["node", "index.js"]