# Local event setup (Docker + LAN)

This guide runs the voting platform on an event computer and lets phones on the same Wi-Fi use it. It keeps both venue checks enabled: the device's network and its GPS location.

## Why this uses HTTPS and Node.js

**HTTPS is needed for phone GPS.** Browsers only make their geolocation API available to secure pages. The LAN gateway creates a local, self-signed HTTPS certificate for the computer's detected Wi-Fi address. The first visit shows a certificate warning because the certificate is local rather than issued by a public certificate authority. Accept it only when you are opening the address printed by your own gateway on the event network.

**Node.js runs the LAN gateway on the host computer.** Docker can make every phone look like the same Docker bridge address, such as `172.23.0.1`. The gateway runs outside Docker, can inspect the host's Wi-Fi adapter, and forwards the actual device address and detected Wi-Fi subnet to the app. It also serves HTTPS and creates the local certificate with OpenSSL. The gateway has no npm dependencies; Node.js 20 or newer is sufficient.

## Before you start

- Docker Engine or Docker Desktop with `docker compose` available.
- Node.js 20 or newer on the host. On Ubuntu with nvm, run `source ~/.zshrc` and `nvm install --lts` if needed.
- GNU Make. On Ubuntu, install it with `sudo apt install make` if `make` is not found.
- OpenSSL. On Ubuntu, install it with `sudo apt install openssl` if the gateway says it cannot find OpenSSL.
- The event computer and attendee phones connected to the same venue Wi-Fi.
- `.env` configured with the app secrets and admin password described in the main deployment guide.

No event IP address needs to be copied into `.env` or typed into the admin console for this setup.

## What the LAN setup handles automatically

- The Compose nginx service mounts the intended `deploy/nginx.conf` file.
- The gateway reads the host's real client IP and interface netmask, then forwards the IP and matching Wi-Fi subnet.
- In LAN mode, nginx trusts the gateway's forwarded client IP while its published port is bound to loopback, so phones cannot bypass the gateway.
- The server normalizes Docker's IPv4-mapped IPv6 format for display and access rules.
- Voting and display links use the address through which the admin opened the dashboard. `PUBLIC_URL` and the event address field can remain empty for a local event.
- The saved default access mode checks both venue Wi-Fi and GPS.

## Start the event platform

1. Open a terminal in the project folder. Check that Node and Docker Compose are available:

   ```sh
   node --version
   docker compose version
   ```

2. Start the platform and gateway with one command:

   ```sh
   make
   ```

   Plain `make` defaults to the `lan` target. It builds and starts Docker with the LAN-safe settings, then runs the gateway. By default it uses HTTPS port `8443` and HTTP redirect port `8080`, which do not require administrator privileges on Linux. The same command is available as `make lan`.
   If you already started the gateway manually in another terminal, stop it with Ctrl+C first.

3. Keep that terminal open. The gateway prints one or more HTTPS addresses, for example:

   ```text
   https://192.168.100.27:8443/
   admin: https://192.168.100.27:8443/admin
   ```

4. Open the printed admin address. Accept the local certificate warning. Use this HTTPS address on the event computer and phones; do not open the admin page through `localhost` or Docker's direct port.

5. In **Settings → On-site access**, click **Use this network** and **Use my location**, allow the browser's location request, then save. The gateway detects the subnet from the host adapter, so no CIDR or IP needs to be typed. The default **Wi-Fi and location** rule checks both signals.

6. Open the voting link or QR from the dashboard on a phone connected to the venue Wi-Fi and inside the geofence; it should pass. A phone outside the venue network should be refused by the combined rule.

## If a port is already in use

The default gateway port is `8443`. If it is busy, choose another unprivileged port:

```sh
make LAN_PORT=9443 LAN_HTTP_PORT=8081
```

Use the HTTPS address printed by Make; it will include `:9443`. To try standard HTTPS port 443 instead, run `make lan-443`. Port 443 may already be in use or require elevated privileges, so the default `make` is recommended.

## If the admin page still shows a Docker address

- Make sure you opened the admin page using the HTTPS address printed by the gateway.
- Do not use `http://localhost`, `http://127.0.0.1`, or Docker's published port directly.
- Start the platform with `make`; it applies `HTTP_BIND=127.0.0.1` and `REAL_IP_CONF=real-ip.lan.conf` for you.
- If you changed the Wi-Fi network, stop the gateway with Ctrl+C and run `make` again. It will refresh the certificate and detected subnet as needed.

To stop the gateway, press Ctrl+C in its terminal. Docker can remain running; it does not affect the detected address when the gateway is stopped.
