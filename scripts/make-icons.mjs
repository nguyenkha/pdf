// Renders the PNG app icons Android needs to install the app (and use its
// share target). Run after changing public/icons/icon.svg.
import fs from "node:fs";
import { chromium } from "@playwright/test";

const svg = fs.readFileSync("public/icons/icon.svg", "utf8");
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size, padding] of [
  ["icon-192.png", 192, 0],
  ["icon-512.png", 512, 0],
  // Maskable icons keep their content inside the central 80% safe zone.
  ["maskable-512.png", 512, 0.12],
]) {
  await page.setViewportSize({ width: size, height: size });
  const inset = Math.round(size * padding);
  await page.setContent(
    `<body style="margin:0;background:${padding ? "#c44916" : "transparent"}"><div style="padding:${inset}px">${svg.replace("<svg ", `<svg width="${size - 2 * inset}" height="${size - 2 * inset}" `)}</div></body>`,
  );
  await page.screenshot({ path: `public/icons/${name}`, omitBackground: !padding });
}
await browser.close();
