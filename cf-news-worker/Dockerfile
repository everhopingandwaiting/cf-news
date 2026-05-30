FROM node:22-slim

WORKDIR /app

RUN npm config set registry https://registry.npmmirror.com

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

EXPOSE 8787

CMD ["npx", "wrangler", "dev", "--local", "--port", "8787"]