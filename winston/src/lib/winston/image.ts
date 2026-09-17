const MAX_EXTRACT_CHARS = 1_400_000;

export async function preparePhoto(file: File): Promise<{
  displayUrl: string;
  extractUrl: string;
}> {
  const raw = await readFileAsDataUrl(file);
  const img = await loadImage(raw);
  const displayUrl = encodeJpeg(img, 2200, 0.9);
  let edge = 1700;
  let quality = 0.78;
  let extractUrl = encodeJpeg(img, edge, quality);
  for (let i = 0; i < 6 && extractUrl.length > MAX_EXTRACT_CHARS; i += 1) {
    edge = Math.max(800, Math.round(edge * 0.86));
    quality = Math.max(0.58, quality - 0.04);
    extractUrl = encodeJpeg(img, edge, quality);
  }
  return { displayUrl, extractUrl };
}

export async function measurePhoto(dataUrl: string) {
  const img = await loadImage(dataUrl);
  return { width: img.width, height: img.height };
}

export async function fileToJpegDataUrl(file: File): Promise<string> {
  const prepared = await preparePhoto(file);
  return prepared.extractUrl;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string" && result.length > 32) {
        resolve(result);
        return;
      }
      reject(new Error("That file was empty."));
    };
    reader.onerror = () => reject(new Error("Could not open that photo."));
    reader.readAsDataURL(file);
  });
}

function encodeJpeg(
  img: CanvasImageSource & { width: number; height: number },
  maxEdge: number,
  quality: number,
) {
  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height, 1));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not read that photo.");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", quality);
}

export async function splitIntoHalves(
  dataUrl: string,
  axis: "auto" | "vertical" | "horizontal" = "auto",
  quality = 0.88,
): Promise<string[]> {
  const img = await loadImage(dataUrl);
  const landscape = img.width >= img.height * 1.08;
  const splitSide =
    axis === "vertical" ? true : axis === "horizontal" ? false : landscape;
  if (splitSide) {
    const overlap = Math.round(img.width * 0.06);
    const mid = Math.round(img.width / 2);
    return [
      cropJpeg(img, 0, 0, mid + overlap, img.height, quality),
      cropJpeg(img, Math.max(0, mid - overlap), 0, img.width - mid + overlap, img.height, quality),
    ];
  }
  const overlap = Math.round(img.height * 0.06);
  const mid = Math.round(img.height / 2);
  return [
    cropJpeg(img, 0, 0, img.width, mid + overlap, quality),
    cropJpeg(img, 0, Math.max(0, mid - overlap), img.width, img.height - mid + overlap, quality),
  ];
}

function cropJpeg(
  img: CanvasImageSource & { width: number; height: number },
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  quality: number,
) {
  const canvas = document.createElement("canvas");
  const width = Math.max(1, Math.round(sw));
  const height = Math.max(1, Math.round(sh));
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not split that photo.");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", quality);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      if (!img.width || !img.height) {
        reject(new Error("That photo would not open."));
        return;
      }
      resolve(img);
    };
    img.onerror = () =>
      reject(new Error("That photo format is not supported. Try a screenshot or JPEG."));
    img.src = src;
  });
}
