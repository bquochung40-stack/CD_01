FROM nginx:stable-alpine
ARG APK_MIRROR=https://mirror.freedif.org/alpine
RUN sed -i "s#https://dl-cdn.alpinelinux.org/alpine#${APK_MIRROR}#" /etc/apk/repositories \
    && apk upgrade --no-cache
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY public /usr/share/nginx/html
EXPOSE 80
