# build stage
# --------------------
FROM node:26-alpine AS build

WORKDIR /app/

COPY package*.json /app/

RUN npm install

COPY . /app/

# Optional external token-provider config, inlined by Vite at build time
# (see src/lib/authProvider.ts). Unset -> feature inert (upstream behaviour);
# the concrete URLs are supplied via --build-arg in deploy.yml.
ARG VITE_TOKEN_PROVIDER_URL
ARG VITE_LOGIN_URL

RUN npm run build

# nginx stage
# --------------------
FROM nginx:mainline-alpine

RUN mkdir /var/www/html/ -p

ENV NGINX_PORT=8000
EXPOSE 8000/tcp

COPY --from=build /app/dist/ /var/www/html/

COPY nginx.conf /etc/nginx/templates/dzenalitics.conf.template
