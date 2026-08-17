FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev
COPY . .
RUN mkdir -p data/users data/codes data/threads data/notifications data/profile_pictures
EXPOSE 8700
CMD ["node", "src/server.js"]
