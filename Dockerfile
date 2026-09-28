FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src
COPY public ./public
COPY openapi.yaml ./
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
