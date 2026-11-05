FROM node:24-alpine
RUN npm install --global firebase-tools@15.34.2
WORKDIR /app
COPY firebase.json /app/firebase.json
CMD ["firebase", "emulators:start", "--only", "auth", "--project", "demo-mobile-tracer", "--config", "/app/firebase.json", "--import", "/data", "--export-on-exit", "/data"]
