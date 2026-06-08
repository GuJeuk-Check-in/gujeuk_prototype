FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html /usr/share/nginx/html/index.html
COPY v1 /usr/share/nginx/html/v1
COPY v2 /usr/share/nginx/html/v2

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=5s --retries=5 --start-period=5s \
  CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1
