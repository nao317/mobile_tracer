import express from "express";
import { createRequestHandler } from "@react-router/express";
import * as build from "./build/server/index.js";

const app = express();
app.disable("x-powered-by");
const proxies = (process.env.TRUSTED_PROXY_CIDRS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
app.set("trust proxy", proxies.length ? proxies : false);
app.use((req, res, next) => {
  res.on("finish", () => {
    console.log(JSON.stringify({
      method: req.method, uri: req.originalUrl, status: res.statusCode,
      host: req.get("host"), remote_ip: req.ip, scheme: req.protocol,
    }));
  });
  next();
});
app.use("/assets", express.static("build/client/assets", { immutable: true, maxAge: "1y" }));
app.use(express.static("build/client"));
app.all("/{*splat}", createRequestHandler({ build, mode: process.env.NODE_ENV || "production" }));

const port = Number(process.env.PORT || "3000");
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}
const server = app.listen(port, process.env.HOST || "0.0.0.0", () => {
  console.log(`Frontend server listening on port ${port}`);
});
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, () => server.close());
}
