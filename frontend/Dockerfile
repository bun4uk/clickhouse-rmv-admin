# ---- build stage ----
FROM node:22-alpine AS build
WORKDIR /app

# .npmrc enforces ignore-scripts (supply-chain). Install from the committed
# lockfile so every package is integrity-checked (SHA512) and version-pinned.
COPY .npmrc package.json package-lock.json ./
RUN npm ci

# esbuild/rolldown/tailwind-oxide ship native binaries as optionalDependencies
# (no scripts needed); but esbuild also has an install script we skipped, so
# rebuild ONLY that trusted, explicitly-named package.
RUN npm rebuild esbuild 2>/dev/null || true

COPY . .
RUN npm run build

# ---- runtime stage ----
FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
