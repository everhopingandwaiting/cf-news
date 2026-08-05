FROM node:22-slim

WORKDIR /app

RUN npm config set registry https://registry.npmmirror.com

# Build toolchain for native deps (better-sqlite3) via Aliyun mirror
RUN sed -i 's|deb.debian.org|mirrors.aliyun.com|g; s|security.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null; \
    sed -i 's|deb.debian.org|mirrors.aliyun.com|g; s|security.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list 2>/dev/null; \
    apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# Install dependencies only — source code is mounted at runtime
COPY package.json package-lock.json* ./
RUN npm install

EXPOSE 8787

CMD ["npx", "wrangler", "dev", "--local", "--port", "8787"]