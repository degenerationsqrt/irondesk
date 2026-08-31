const fs = require("node:fs");
const path = require("node:path");

const sharpModule = process.env.IRONDESK_SHARP_MODULE || "sharp";
// `sharp` is intentionally a tooling-only dependency. Set IRONDESK_SHARP_MODULE
// to an installed module path when it is not available in this workspace.
const sharp = require(sharpModule);

const assetsDir = __dirname;
const repositoryRoot = path.resolve(assetsDir, "..", "..", "..");
const markSource = path.join(
  repositoryRoot,
  "connectiq",
  "irondesk",
  "store-assets",
  "irondesk-icon-source.png",
);
const backgroundSource = path.join(assetsDir, "feature-graphic-background-generated.png");
const screenshotSourceDir = path.join(repositoryRoot, "output", "playwright");
const screenshotOutputDir = path.join(assetsDir, "phone-screenshots");
const screenshotPairs = [
  ["phone-dashboard.png", "01-today-1080x1920.png"],
  ["phone-workout.png", "02-workout-1080x1920.png"],
  ["phone-progress.png", "03-progress-1080x1920.png"],
  ["phone-recovery.png", "04-recovery-1080x1920.png"],
];

const featureOverlay = Buffer.from(`
  <svg width="1024" height="500" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="shade" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#05090f" stop-opacity="0.98"/>
        <stop offset="0.56" stop-color="#05090f" stop-opacity="0.76"/>
        <stop offset="1" stop-color="#05090f" stop-opacity="0.10"/>
      </linearGradient>
      <linearGradient id="title" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#f7fbff"/>
        <stop offset="1" stop-color="#8ed0ff"/>
      </linearGradient>
    </defs>
    <rect width="1024" height="500" fill="url(#shade)"/>
    <rect x="45" y="55" width="6" height="390" rx="3" fill="#159cff"/>
    <text x="286" y="223" font-family="Arial Narrow, Segoe UI, sans-serif"
      font-size="70" font-stretch="condensed" font-weight="900"
      letter-spacing="1" fill="url(#title)">IRONDESK</text>
    <text x="291" y="271" font-family="Segoe UI, Arial, sans-serif"
      font-size="23" font-weight="700" letter-spacing="5"
      fill="#159cff">TRAINING INTELLIGENCE</text>
    <text x="291" y="323" font-family="Segoe UI, Arial, sans-serif"
      font-size="17" font-weight="600" letter-spacing="2.5"
      fill="#c7d0dc">TRAIN · RECOVER · PROGRESS</text>
  </svg>
`);

async function sanitizedMark() {
  const { data, info } = await sharp(markSource)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // The source artwork contains low-alpha generator noise across the otherwise
  // transparent canvas. Clear that noise before trimming so it cannot render as
  // dark rectangular bands after the mark is resized.
  for (let offset = 3; offset < data.length; offset += 4) {
    const red = data[offset - 3];
    const green = data[offset - 2];
    const blue = data[offset - 1];
    const isGeneratorBlack = red <= 16 && green <= 16 && blue <= 16;
    if (data[offset] <= 16 || isGeneratorBlack) data[offset] = 0;
  }

  return sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: info.channels,
    },
  })
    .trim()
    .png()
    .toBuffer();
}

async function build() {
  const cleanMark = await sanitizedMark();
  const iconForeground = await sharp(cleanMark)
    .resize(430, 430, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: 512,
      height: 512,
      channels: 4,
      background: { r: 5, g: 10, b: 18, alpha: 1 },
    },
  })
    .composite([{ input: iconForeground, left: 41, top: 41 }])
    .png({ compressionLevel: 9 })
    .toFile(path.join(assetsDir, "app-icon-512.png"));

  const featureBackground = await sharp(backgroundSource)
    .resize(1024, 500, { fit: "cover", position: "centre" })
    .toBuffer();
  const featureMark = await sharp(cleanMark)
    .resize(185, 185, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  await sharp(featureBackground)
    .composite([
      { input: featureOverlay, left: 0, top: 0 },
      { input: featureMark, left: 78, top: 157 },
    ])
    // Play feature graphics must be JPEG or 24-bit PNG with no alpha channel.
    .flatten({ background: "#05090f" })
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toFile(path.join(assetsDir, "feature-graphic-1024x500.png"));

  await fs.promises.mkdir(screenshotOutputDir, { recursive: true });
  for (const [sourceName, outputName] of screenshotPairs) {
    const sourcePath = path.join(screenshotSourceDir, sourceName);
    if (!fs.existsSync(sourcePath)) continue;
    await sharp(sourcePath)
      .resize(1080, 1920, { fit: "fill", kernel: sharp.kernel.lanczos3 })
      .png({ compressionLevel: 9 })
      .toFile(path.join(screenshotOutputDir, outputName));
  }
}

build().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
