const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const sharp = require("sharp");

const memberDirectory = path.join(__dirname, "members");
const distDirectory = path.join(__dirname, "dist");
const distMemberDirectory = path.join(distDirectory, "members");
// Persistent build cache inside node_modules (preserved across builds by Cloudflare Pages Build Cache)
const cacheDirectory = path.join(__dirname, "node_modules", ".cache", "gdgoc-images");
const imagePattern = /\.(avif|gif|jpe?g|png|webp)$/i;

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

function getFileHash(filePath) {
  const buffer = fs.readFileSync(filePath);
  return crypto
    .createHash("sha256")
    .update("v1-400x400-q80") // Invalidate cache if resize/quality config changes
    .update(buffer)
    .digest("hex")
    .slice(0, 24);
}

function findImageFiles(directory) {
  if (!fs.existsSync(directory)) return [];

  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);

    if (entry.isDirectory()) return findImageFiles(absolutePath);
    if (!entry.isFile() || !imagePattern.test(entry.name)) return [];
    if (entry.name.toLowerCase() === "readme.md") return [];

    return absolutePath;
  });
}

// Find all generated webp files in dist to prune removed images
function findExistingWebpFiles(directory) {
  if (!fs.existsSync(directory)) return [];

  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return findExistingWebpFiles(absolutePath);
    if (entry.isFile() && entry.name.endsWith(".webp")) return [absolutePath];
    return [];
  });
}

// Simple concurrency runner
async function mapConcurrent(items, limit, fn) {
  const results = [];
  const executing = new Set();

  for (const item of items) {
    const p = Promise.resolve().then(() => fn(item));
    results.push(p);
    executing.add(p);

    const clean = () => executing.delete(p);
    p.then(clean, clean);

    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }

  return Promise.all(results);
}

async function build() {
  const startTime = performance.now();
  console.log("🚀 Starting incremental build process...");

  // 1. Ensure dist/, dist/members/, and cache directories exist
  fs.mkdirSync(distMemberDirectory, { recursive: true });
  fs.mkdirSync(cacheDirectory, { recursive: true });

  // 2. Incrementally copy static web assets
  const staticFiles = ["index.html", "style.css", "script.js"];
  for (const file of staticFiles) {
    const src = path.join(__dirname, file);
    const dest = path.join(distDirectory, file);

    if (fs.existsSync(src)) {
      const srcStat = fs.statSync(src);
      const destExists = fs.existsSync(dest);
      const destStat = destExists ? fs.statSync(dest) : null;

      if (!destExists || srcStat.mtimeMs > destStat.mtimeMs) {
        fs.copyFileSync(src, dest);
      }
    }
  }

  // 3. Scan member images
  const imageFiles = findImageFiles(memberDirectory);
  console.log(`📸 Found ${imageFiles.length} member photo(s).`);

  const concurrency = Math.max(2, Math.min(os.cpus().length, 8));
  const validTargetAbsPaths = new Set();

  let convertedCount = 0;
  let cachedCount = 0;

  const results = await mapConcurrent(imageFiles, concurrency, async (srcPath) => {
    const relFromMembers = path.relative(memberDirectory, srcPath);
    const parsed = path.parse(relFromMembers);
    const targetRelPath = path.join(parsed.dir, `${parsed.name}.webp`);
    const targetAbsPath = path.join(distMemberDirectory, targetRelPath);

    validTargetAbsPaths.add(path.normalize(targetAbsPath));
    fs.mkdirSync(path.dirname(targetAbsPath), { recursive: true });

    const originalStats = fs.statSync(srcPath);
    const normalizedPath = targetRelPath.split(path.sep).join("/");

    // Compute content hash to support stateless CI / Cloudflare Build Cache
    const fileHash = getFileHash(srcPath);
    const cachedFilePath = path.join(cacheDirectory, `${fileHash}.webp`);

    // Incremental Check: If cached optimized WebP exists in persistent cache, copy & skip!
    if (fs.existsSync(cachedFilePath)) {
      fs.copyFileSync(cachedFilePath, targetAbsPath);
      const targetStats = fs.statSync(targetAbsPath);
      cachedCount += 1;
      console.log(`  ↷ [Cached] ${relFromMembers} (${formatBytes(targetStats.size)})`);
      return {
        normalizedPath,
        originalSize: originalStats.size,
        optimizedSize: targetStats.size,
        isCached: true,
      };
    }

    // Need to convert
    convertedCount += 1;
    const isGif = parsed.ext.toLowerCase() === ".gif";

    try {
      await sharp(srcPath, { animated: isGif })
        .resize({
          width: 400,
          height: 400,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({
          quality: 80,
          effort: 4,
        })
        .toFile(targetAbsPath);

      // Save to persistent cache so future builds reuse it
      fs.copyFileSync(targetAbsPath, cachedFilePath);

      const optimizedStats = fs.statSync(targetAbsPath);
      console.log(
        `  ✓ [New] ${relFromMembers} (${formatBytes(originalStats.size)}) -> ${normalizedPath} (${formatBytes(optimizedStats.size)})`
      );

      return {
        normalizedPath,
        originalSize: originalStats.size,
        optimizedSize: optimizedStats.size,
        isCached: false,
      };
    } catch (err) {
      console.warn(`  ⚠️ Failed to optimize ${relFromMembers}, copying original:`, err.message);
      const fallbackAbsPath = path.join(distMemberDirectory, relFromMembers);
      fs.copyFileSync(srcPath, fallbackAbsPath);

      return {
        normalizedPath: relFromMembers.split(path.sep).join("/"),
        originalSize: originalStats.size,
        optimizedSize: originalStats.size,
        isCached: false,
      };
    }
  });

  // 4. Prune removed images from dist/members/
  const existingWebpFiles = findExistingWebpFiles(distMemberDirectory);
  for (const existingFile of existingWebpFiles) {
    if (!validTargetAbsPaths.has(path.normalize(existingFile))) {
      fs.rmSync(existingFile, { force: true });
      console.log(`  🗑️ [Pruned] Removed deleted photo from dist: ${path.relative(distMemberDirectory, existingFile)}`);
    }
  }

  // 5. Generate dist/photos.js
  const photoEntries = results.map((r) => r.normalizedPath).sort((a, b) => a.localeCompare(b));
  const photosJsContent = `// Generated automatically by build.js.\nwindow.PHOTOS = ${JSON.stringify(
    photoEntries,
    null,
    2
  )};\n`;
  fs.writeFileSync(path.join(distDirectory, "photos.js"), photosJsContent);

  // 6. Summary Statistics
  const totalOriginalBytes = results.reduce((acc, r) => acc + r.originalSize, 0);
  const totalOptimizedBytes = results.reduce((acc, r) => acc + r.optimizedSize, 0);
  const savedBytes = totalOriginalBytes - totalOptimizedBytes;
  const savedPercent = totalOriginalBytes > 0 ? ((savedBytes / totalOriginalBytes) * 100).toFixed(1) : 0;
  const elapsedMs = (performance.now() - startTime).toFixed(0);

  console.log("\n✨ Build completed successfully!");
  console.log(`⏱️ Duration: ${elapsedMs} ms`);
  console.log(`📦 Status: ${convertedCount} converted, ${cachedCount} skipped (cached).`);
  console.log(`📊 Image Optimization Summary:`);
  console.log(`   - Original size:   ${formatBytes(totalOriginalBytes)}`);
  console.log(`   - Optimized size:  ${formatBytes(totalOptimizedBytes)}`);
  console.log(`   - Bandwidth saved: ${formatBytes(savedBytes)} (-${savedPercent}%)`);
}

build().catch((err) => {
  console.error("❌ Build failed:", err);
  process.exit(1);
});
