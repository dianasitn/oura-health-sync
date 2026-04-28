FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
RUN mkdir -p data/reports
EXPOSE 3001
CMD ["node", "src/index.js"]