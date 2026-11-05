import { getApps, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, inMemoryPersistence, setPersistence } from "firebase/auth";
import type { FirebaseConfig } from "./auth.server";

let initialized: Promise<ReturnType<typeof getAuth>> | undefined;
// Credentials live only in memory until exchanged for the server's HttpOnly cookie.
export function firebaseAuth(config: FirebaseConfig) {
  initialized ??= (async () => {
    const name = "mobiltracer";
    const app = getApps().find((app) => app.name === name) || initializeApp(config, name);
    const auth = getAuth(app);
    if (config.emulatorUrl) connectAuthEmulator(auth, config.emulatorUrl, { disableWarnings: true });
    await setPersistence(auth, inMemoryPersistence);
    auth.languageCode = "ja";
    return auth;
  })();
  return initialized;
}
