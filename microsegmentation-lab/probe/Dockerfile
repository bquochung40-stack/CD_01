FROM alpine:3.20
RUN sed -i "s#https://dl-cdn.alpinelinux.org/alpine#https://mirror.freedif.org/alpine#" /etc/apk/repositories \
    && apk add --no-cache curl netcat-openbsd
CMD ["/bin/sh", "-c", "sleep 36000"]
