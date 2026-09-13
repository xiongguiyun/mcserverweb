const page = document.body?.dataset.page || "";

globalThis.__BLOCKHAVEN_MANUAL_BOOT__ = true;
const app = await import("./app.js");

app.bootApp?.(page);
