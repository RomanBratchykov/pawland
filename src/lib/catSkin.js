function imageFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to decode image from data URL'));
    image.src = dataUrl;
  });
}

function createCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function canvasesToDataUrls(parts = {}) {
  const result = {};

  Object.entries(parts).forEach(([key, canvas]) => {
    if (!canvas || typeof canvas.toDataURL !== 'function') return;
    result[key] = canvas.toDataURL('image/png');
  });

  return result;
}

export async function dataUrlsToCanvases(dataUrls = {}) {
  const result = {};

  for (const [key, dataUrl] of Object.entries(dataUrls)) {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) continue;

    const image = await imageFromDataUrl(dataUrl);
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    result[key] = canvas;
  }

  return result;
}
