# 培训学校收费系统 · 后端 Dockerfile
FROM node:22-alpine AS builder
WORKDIR /app

# 依赖安装（跳过 postinstall 脚本，避免沙箱环境二进制问题；生产构建建议去掉 --ignore-scripts）
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts --no-audit --no-fund

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npx tsc -p tsconfig.build.json

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts --omit=dev --no-audit --no-fund

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

EXPOSE 3000
# 启动前执行迁移，然后启动服务
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
