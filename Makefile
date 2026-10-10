LAN_PORT ?= 8443
LAN_HTTP_PORT ?= 8080
export LAN_PORT LAN_HTTP_PORT

.DEFAULT_GOAL := lan

.PHONY: help lan lan-443

help:
	@echo "make           Build/start Docker and run the local HTTPS gateway on :$(LAN_PORT)"
	@echo "make lan       Same as make"
	@echo "make lan-443   Build/start Docker and run the gateway on standard HTTPS port 443"
	@echo "Override ports with: make lan LAN_PORT=9443 LAN_HTTP_PORT=8081"

lan:
	@node scripts/start-lan.mjs

lan-443:
	@$(MAKE) lan LAN_PORT=443
