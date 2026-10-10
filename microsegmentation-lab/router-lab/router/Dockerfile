FROM quay.io/frrouting/frr:10.7.1
USER root
RUN apk add --no-cache iptables
COPY --chown=frr:frr frr.conf /etc/frr/frr.conf
RUN touch /etc/frr/vtysh.conf && chown frr:frr /etc/frr/vtysh.conf
COPY init.sh /router-init.sh
RUN chmod 755 /router-init.sh
CMD ["/router-init.sh"]
