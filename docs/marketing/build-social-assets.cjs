const fs = require("node:fs");
const path = require("node:path");

const sharpModule = process.env.IRONDESK_SHARP_MODULE || "sharp";
const sharp = require(sharpModule);

const marketingDir = __dirname;
const repositoryRoot = path.resolve(marketingDir, "..", "..");
const outputDir = path.join(marketingDir, "assets");
const playAssetDir = path.join(repositoryRoot, "docs", "google-play", "assets");
const backgroundPath = path.join(playAssetDir, "feature-graphic-background-generated.png");
const iconPath = path.join(playAssetDir, "app-icon-512.png");
const todayPath = path.join(playAssetDir, "phone-screenshots", "01-today-1080x1920.png");
const workoutPath = path.join(playAssetDir, "phone-screenshots", "02-workout-1080x1920.png");

function escapeXml(value) {
  return value.replace(/[<>&'\"]/g, (character) => {
    const entities = { "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '\"': "&quot;" };
    return entities[character];
  });
}

function svgBuffer(width, height, body) {
  return Buffer.from(
    `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`,
  );
}

async function roundedScreenshot(source, width, height, radius = 28) {
  const screenshot = await sharp(source).resize(width, height, { fit: "cover" }).png().toBuffer();
  const mask = svgBuffer(
    width,
    height,
    `<rect width="${width}" height="${height}" rx="${radius}" fill="#fff"/>`,
  );
  return sharp(screenshot)
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();
}

async function baseBackground(width, height) {
  return sharp(backgroundPath)
    .resize(width, height, { fit: "cover", position: "centre" })
    .modulate({ brightness: 0.8, saturation: 0.9 })
    .blur(0.35)
    .png()
    .toBuffer();
}

async function buildLandscape() {
  const width = 1200;
  const height = 627;
  const background = await baseBackground(width, height);
  const icon = await sharp(iconPath).resize(108, 108).png().toBuffer();
  const today = await roundedScreenshot(todayPath, 226, 402, 24);
  const workout = await roundedScreenshot(workoutPath, 268, 476, 28);
  const overlay = svgBuffer(
    width,
    height,
    `
      <defs>
        <linearGradient id="shade" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#05090f" stop-opacity="0.99"/>
          <stop offset="0.58" stop-color="#07101c" stop-opacity="0.94"/>
          <stop offset="1" stop-color="#07101c" stop-opacity="0.35"/>
        </linearGradient>
        <linearGradient id="headline" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#f7fbff"/>
          <stop offset="1" stop-color="#9ed8ff"/>
        </linearGradient>
        <filter id="shadow"><feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#000" flood-opacity="0.65"/></filter>
      </defs>
      <rect width="1200" height="630" fill="url(#shade)"/>
      <rect x="54" y="52" width="5" height="526" rx="2.5" fill="#159cff"/>
      <text x="188" y="113" font-family="Arial Narrow, Segoe UI, sans-serif" font-size="48" font-weight="900" letter-spacing="1" fill="#f7fbff">IRON<tspan fill="#159cff">DESK</tspan></text>
      <text x="78" y="219" font-family="Arial Narrow, Segoe UI, sans-serif" font-size="55" font-weight="900" fill="url(#headline)">TRAIN WITH EVIDENCE.</text>
      <text x="78" y="279" font-family="Arial Narrow, Segoe UI, sans-serif" font-size="55" font-weight="900" fill="url(#headline)">PROGRESS WITH INTENT.</text>
      <text x="81" y="329" font-family="Segoe UI, Arial, sans-serif" font-size="20" font-weight="700" letter-spacing="4" fill="#159cff">INSTALLABLE WEB BETA</text>
      <text x="81" y="384" font-family="Segoe UI, Arial, sans-serif" font-size="22" font-weight="500" fill="#c7d0dc">Programs · workout execution · history</text>
      <text x="81" y="418" font-family="Segoe UI, Arial, sans-serif" font-size="22" font-weight="500" fill="#c7d0dc">progress · recovery · nutrition</text>
      <rect x="79" y="476" width="248" height="55" rx="14" fill="#159cff"/>
      <text x="203" y="511" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="18" font-weight="800" letter-spacing="1.5" fill="#06101c">EXPLORE THE DEMO</text>
      <g filter="url(#shadow)"><rect x="754" y="139" width="238" height="414" rx="30" fill="#0a1018" stroke="#2d3c4f" stroke-width="6"/><rect x="884" y="54" width="282" height="500" rx="34" fill="#0a1018" stroke="#159cff" stroke-width="6"/></g>
    `,
  );

  await sharp(background)
    .composite([
      { input: overlay, left: 0, top: 0 },
      { input: icon, left: 72, top: 49 },
      { input: today, left: 760, top: 145 },
      { input: workout, left: 891, top: 62 },
    ])
    .flatten({ background: "#05090f" })
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toFile(path.join(outputDir, "irondesk-pwa-launch-1200x627.png"));
}

async function buildSquare() {
  const width = 1080;
  const height = 1080;
  const background = await baseBackground(width, height);
  const icon = await sharp(iconPath).resize(118, 118).png().toBuffer();
  const today = await roundedScreenshot(todayPath, 300, 533, 30);
  const workout = await roundedScreenshot(workoutPath, 336, 597, 34);
  const lines = ["TRAIN WITH EVIDENCE.", "PROGRESS WITH INTENT."];
  const overlay = svgBuffer(
    width,
    height,
    `
      <defs>
        <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#05090f" stop-opacity="0.98"/>
          <stop offset="0.53" stop-color="#07101c" stop-opacity="0.92"/>
          <stop offset="1" stop-color="#05090f" stop-opacity="0.78"/>
        </linearGradient>
        <filter id="shadow"><feDropShadow dx="0" dy="20" stdDeviation="20" flood-color="#000" flood-opacity="0.7"/></filter>
      </defs>
      <rect width="1080" height="1080" fill="url(#shade)"/>
      <rect x="64" y="58" width="5" height="964" rx="2.5" fill="#159cff"/>
      <text x="206" y="132" font-family="Arial Narrow, Segoe UI, sans-serif" font-size="52" font-weight="900" letter-spacing="1" fill="#f7fbff">IRON<tspan fill="#159cff">DESK</tspan></text>
      <text x="76" y="231" font-family="Arial Narrow, Segoe UI, sans-serif" font-size="60" font-weight="900" fill="#f7fbff">${escapeXml(lines[0])}</text>
      <text x="76" y="296" font-family="Arial Narrow, Segoe UI, sans-serif" font-size="60" font-weight="900" fill="#9ed8ff">${escapeXml(lines[1])}</text>
      <text x="79" y="345" font-family="Segoe UI, Arial, sans-serif" font-size="20" font-weight="800" letter-spacing="4" fill="#159cff">INSTALLABLE WEB BETA · EXPLORE THE DEMO</text>
      <g filter="url(#shadow)"><rect x="164" y="469" width="318" height="551" rx="36" fill="#0a1018" stroke="#2d3c4f" stroke-width="7"/><rect x="525" y="397" width="354" height="615" rx="40" fill="#0a1018" stroke="#159cff" stroke-width="7"/></g>
    `,
  );

  await sharp(background)
    .composite([
      { input: overlay, left: 0, top: 0 },
      { input: icon, left: 76, top: 47 },
      { input: today, left: 173, top: 478 },
      { input: workout, left: 534, top: 406 },
    ])
    .flatten({ background: "#05090f" })
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toFile(path.join(outputDir, "irondesk-pwa-launch-1080x1080.png"));
}

async function build() {
  await fs.promises.mkdir(outputDir, { recursive: true });
  await Promise.all([buildLandscape(), buildSquare()]);
}

build().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
