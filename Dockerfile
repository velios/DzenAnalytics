# build stage
# --------------------
FROM node:26-alpine AS build

WORKDIR /app/

COPY package*.json /app/

RUN npm install

# exclude nginx config so it wont cause rebuilds
COPY --exclude=nginx.conf . /app/

RUN npm run build

# nginx stage
# --------------------
FROM nginx:mainline

RUN mkdir /var/www/html/ -p

ENV NGINX_PORT=8000
EXPOSE 8000/tcp

COPY --from=build /app/dist/ /var/www/html/

COPY nginx.conf /etc/nginx/templates/dzenalitics.conf.template
