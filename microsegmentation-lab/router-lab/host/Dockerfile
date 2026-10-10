FROM python:3.12-alpine
RUN apk add --no-cache curl iproute2 netcat-openbsd
COPY start.sh /host-start.sh
RUN chmod 755 /host-start.sh && mkdir -p /srv && echo 'router-lab host ready' > /srv/index.html
CMD ["/host-start.sh"]
