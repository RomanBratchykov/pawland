import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getFallbackSkeletonLayout, loadSkeletonLayout } from '../lib/skeletonLayout.js';

const PART_SIZES = {
  head: [200, 200],
  body: [180, 160],
  leg: [80, 130],
  tail: [80, 200],
};

const PART_KEYS = ['head', 'body', 'leg', 'tail'];

const PART_LABELS = {
  head: 'Head',
  body: 'Body',
  leg: 'Paws',
  tail: 'Tail',
};

const SYSTEM_DEFAULT_BASENAME = {
  head: 'head0',
  body: 'body0',
  leg: 'leg0',
  tail: 'tail0',
};

const DEFAULT_KITTEN = {
  name: 'My Cat',
};

const STORAGE_KEY_KITTEN = 'catGame.kittenBuilder.v2';
const STORAGE_KEY_PART_LIBRARY = 'catGame.kittenPartLibrary.v2';
const STORAGE_KEY_SELECTED_PARTS = 'catGame.kittenSelectedParts.v2';

const DEFAULT_PART_IMAGE_MODULES = import.meta.glob('../assets/Pngs/*.{png,jpg,jpeg,webp}', {
  eager: true,
  import: 'default',
});

function createEmptyPartLibrary() {
  return {
    head: [],
    body: [],
    leg: [],
    tail: [],
  };
}

function createEmptySelectedParts() {
  return {
    head: null,
    body: null,
    leg: null,
    tail: null,
  };
}

function clonePartLibrary(partLibrary) {
  const clone = createEmptyPartLibrary();
  PART_KEYS.forEach((partKey) => {
    clone[partKey] = (partLibrary?.[partKey] || []).map((item) => ({ ...item }));
  });
  return clone;
}

function sanitizePartLibrary(raw) {
  const result = createEmptyPartLibrary();

  PART_KEYS.forEach((partKey) => {
    const list = Array.isArray(raw?.[partKey]) ? raw[partKey] : [];
    result[partKey] = list
      .filter((item) => item && typeof item.id === 'string' && typeof item.dataUrl === 'string')
      .map((item) => ({
        id: item.id,
        name: typeof item.name === 'string' ? item.name : 'Custom part',
        dataUrl: item.dataUrl,
        isSystemDefault: Boolean(item.isSystemDefault),
      }));
  });

  return result;
}

function mergePartLibraries(primary, fallback) {
  const merged = createEmptyPartLibrary();

  PART_KEYS.forEach((partKey) => {
    const output = [];
    const seenUrls = new Set();

    const appendList = (list) => {
      (list || []).forEach((item) => {
        if (!item?.dataUrl || seenUrls.has(item.dataUrl)) return;
        seenUrls.add(item.dataUrl);
        output.push({ ...item });
      });
    };

    appendList(primary?.[partKey]);
    appendList(fallback?.[partKey]);

    merged[partKey] = output;
  });

  return merged;
}

function fileNameFromPath(path) {
  return String(path || '').split('/').pop() || '';
}

function stripExtension(fileName) {
  return String(fileName || '').replace(/\.[^/.]+$/, '');
}

function normalizeBaseName(fileName) {
  return stripExtension(String(fileName || '')).toLowerCase();
}

function inferPartKeyFromName(fileName) {
  const lower = String(fileName || '').toLowerCase();
  if (lower.includes('head')) return 'head';
  if (lower.includes('body') || lower.includes('torso')) return 'body';
  if (lower.includes('tail')) return 'tail';
  if (lower.includes('leg') || lower.includes('paw') || lower.includes('feet')) return 'leg';
  return null;
}

function createPartId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `part-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.readAsDataURL(file);
  });
}

function decodeImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Image decode failed'));
    image.src = dataUrl;
  });
}

function drawCheckerboard(ctx, w, h, tile = 10) {
  for (let y = 0; y < h; y += tile) {
    for (let x = 0; x < w; x += tile) {
      ctx.fillStyle = ((x + y) / tile) % 2 === 0 ? '#d7d7d7' : '#bdbdbd';
      ctx.fillRect(x, y, tile, tile);
    }
  }
}

function fitImageIntoCanvas(image, targetW, targetH) {
  const canvas = createCanvas(targetW, targetH);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, targetW, targetH);

  if (!image.width || !image.height) {
    return canvas;
  }

  const scale = Math.min(targetW / image.width, targetH / image.height);
  const drawW = Math.max(1, Math.round(image.width * scale));
  const drawH = Math.max(1, Math.round(image.height * scale));
  const drawX = Math.round((targetW - drawW) / 2);
  const drawY = Math.round((targetH - drawH) / 2);

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, drawX, drawY, drawW, drawH);
  return canvas;
}

async function decodeImageToCanvas(dataUrl, partKey = null) {
  const image = await decodeImage(dataUrl);

  if (partKey && PART_SIZES[partKey]) {
    const [targetW, targetH] = PART_SIZES[partKey];
    return fitImageIntoCanvas(image, targetW, targetH);
  }

  const maxSide = 512;
  const ratio = Math.min(1, maxSide / Math.max(image.width || 1, image.height || 1));
  const targetW = Math.max(1, Math.round((image.width || 1) * ratio));
  const targetH = Math.max(1, Math.round((image.height || 1) * ratio));
  return fitImageIntoCanvas(image, targetW, targetH);
}

function canvasToCompressedDataUrl(canvas) {
  try {
    const webp = canvas.toDataURL('image/webp', 0.86);
    if (webp.startsWith('data:image/webp')) {
      return webp;
    }
  } catch {
    // Ignore and fallback to PNG.
  }

  return canvas.toDataURL('image/png');
}

function createDefaultSelectedPartsFromLibrary(partLibrary) {
  const selected = createEmptySelectedParts();
  PART_KEYS.forEach((partKey) => {
    const systemDefault = (partLibrary[partKey] || []).find((item) => item.isSystemDefault);
    selected[partKey] = systemDefault?.id || partLibrary[partKey]?.[0]?.id || null;
  });
  return selected;
}

function sanitizeSelectedParts(raw, partLibrary) {
  const selected = createEmptySelectedParts();

  PART_KEYS.forEach((partKey) => {
    const hasExplicitKey = raw && Object.prototype.hasOwnProperty.call(raw, partKey);
    const desiredId = typeof raw?.[partKey] === 'string' ? raw[partKey] : null;
    const exists = desiredId && (partLibrary[partKey] || []).some((item) => item.id === desiredId);

    if (hasExplicitKey) {
      selected[partKey] = exists ? desiredId : null;
      return;
    }

    const systemDefault = (partLibrary[partKey] || []).find((item) => item.isSystemDefault);
    selected[partKey] = systemDefault?.id || partLibrary[partKey]?.[0]?.id || null;
  });

  return selected;
}

function buildBundledDefaultPartLibrary() {
  const collected = createEmptyPartLibrary();
  const counters = { head: 1, body: 1, leg: 1, tail: 1 };

  Object.entries(DEFAULT_PART_IMAGE_MODULES).forEach(([path, url]) => {
    if (typeof url !== 'string') return;

    const fileName = fileNameFromPath(path);
    const partKey = inferPartKeyFromName(fileName);
    if (!partKey) return;

    const normalizedBaseName = normalizeBaseName(fileName);
    const isSystemDefault = normalizedBaseName === SYSTEM_DEFAULT_BASENAME[partKey];
    const index = counters[partKey]++;

    collected[partKey].push({
      id: isSystemDefault ? `system-default-${partKey}` : `bundled-${partKey}-${index}`,
      name: stripExtension(fileName).replace(/[-_]+/g, ' '),
      dataUrl: url,
      isSystemDefault,
    });
  });

  const library = createEmptyPartLibrary();
  PART_KEYS.forEach((partKey) => {
    const list = [...collected[partKey]].sort((a, b) => a.name.localeCompare(b.name));
    const systemDefault = list.find((item) => item.isSystemDefault) || null;
    const rest = list.filter((item) => !item.isSystemDefault);
    library[partKey] = systemDefault ? [systemDefault, ...rest] : rest;
  });

  return library;
}

const BUNDLED_DEFAULT_PART_LIBRARY = buildBundledDefaultPartLibrary();

function loadInitialKitten(initialKitten = null) {
  if (initialKitten) {
    return {
      ...DEFAULT_KITTEN,
      ...initialKitten,
    };
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY_KITTEN);
    if (!raw) return DEFAULT_KITTEN;
    const data = JSON.parse(raw);
    return {
      ...DEFAULT_KITTEN,
      ...data,
    };
  } catch {
    return DEFAULT_KITTEN;
  }
}

function loadInitialPartLibrary(initialPartLibrary = null) {
  if (initialPartLibrary) {
    const fromInitial = sanitizePartLibrary(initialPartLibrary);
    return mergePartLibraries(fromInitial, BUNDLED_DEFAULT_PART_LIBRARY);
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY_PART_LIBRARY);
    if (!raw) {
      return clonePartLibrary(BUNDLED_DEFAULT_PART_LIBRARY);
    }

    const parsed = JSON.parse(raw);
    const fromStorage = sanitizePartLibrary(parsed);
    return mergePartLibraries(fromStorage, BUNDLED_DEFAULT_PART_LIBRARY);
  } catch {
    return clonePartLibrary(BUNDLED_DEFAULT_PART_LIBRARY);
  }
}

function loadInitialSelectedParts(initialSelectedParts = null, partLibrary = createEmptyPartLibrary()) {
  if (initialSelectedParts) {
    return sanitizeSelectedParts(initialSelectedParts, partLibrary);
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY_SELECTED_PARTS);
    if (!raw) {
      return createDefaultSelectedPartsFromLibrary(partLibrary);
    }

    const parsed = JSON.parse(raw);
    return sanitizeSelectedParts(parsed, partLibrary);
  } catch {
    return createDefaultSelectedPartsFromLibrary(partLibrary);
  }
}

function drawContain(ctx, sourceCanvas, x, y, width, height) {
  if (!sourceCanvas?.width || !sourceCanvas?.height) return;

  const scale = Math.min(width / sourceCanvas.width, height / sourceCanvas.height);
  const drawW = Math.max(1, Math.round(sourceCanvas.width * scale));
  const drawH = Math.max(1, Math.round(sourceCanvas.height * scale));
  const drawX = Math.round(x + (width - drawW) / 2);
  const drawY = Math.round(y + (height - drawH) / 2);

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(sourceCanvas, drawX, drawY, drawW, drawH);
}

function drawPlaceholder(ctx, x, y, width, height) {
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 2;
  ctx.fillRect(x, y, width, height);
  ctx.strokeRect(x, y, width, height);

  ctx.beginPath();
  ctx.moveTo(x + 8, y + 8);
  ctx.lineTo(x + width - 8, y + height - 8);
  ctx.moveTo(x + width - 8, y + 8);
  ctx.lineTo(x + 8, y + height - 8);
  ctx.stroke();
}

function CanvasPreview({ title, sourceCanvas, sourceLabel }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const size = 136;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    drawCheckerboard(ctx, size, size, 8);
    if (sourceCanvas) {
      drawContain(ctx, sourceCanvas, 8, 8, size - 16, size - 16);
      return;
    }

    drawPlaceholder(ctx, 8, 8, size - 16, size - 16);
  }, [sourceCanvas]);

  return (
    <div style={s.previewCard}>
      <span style={s.previewTitle}>{title}</span>
      <span style={s.previewSource}>{sourceLabel}</span>
      <canvas
        ref={canvasRef}
        style={{
          width: 136,
          height: 136,
          imageRendering: 'pixelated',
          borderRadius: 10,
          border: '1px solid rgba(255,255,255,0.2)',
        }}
      />
    </div>
  );
}

function FullKittenPreview({ parts }) {
  const canvasRef = useRef(null);
  const [layout, setLayout] = useState(() => getFallbackSkeletonLayout());

  useEffect(() => {
    let active = true;

    loadSkeletonLayout().then((nextLayout) => {
      if (!active || !nextLayout) return;
      setLayout(nextLayout);
    });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const width = 470;
    const height = 280;
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');

    const bg = ctx.createLinearGradient(0, 0, 0, height);
    bg.addColorStop(0, '#1d2538');
    bg.addColorStop(1, '#131a2a');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = 'rgba(0,0,0,0.24)';
    ctx.beginPath();
    ctx.ellipse(265, 230, 115, 22, 0, 0, Math.PI * 2);
    ctx.fill();

    const drawPartBox = (sourceCanvas, box) => {
      ctx.save();
      const centerX = box.x + box.w / 2;
      const centerY = box.y + box.h / 2;
      ctx.translate(centerX, centerY);
      if (box.rotation) ctx.rotate(box.rotation);
      if (box.flipX) ctx.scale(-1, 1);

      if (sourceCanvas) {
        drawContain(ctx, sourceCanvas, -box.w / 2, -box.h / 2, box.w, box.h);
      } else {
        drawPlaceholder(ctx, -box.w / 2, -box.h / 2, box.w, box.h);
      }

      ctx.restore();
    };

    const scale = 0.64;
    const bodyW = layout.body.width * scale;
    const bodyH = layout.body.height * scale;
    const headW = layout.head.width * scale * 0.74;
    const headH = layout.head.height * scale * 0.74;
    const legW = layout.leg.width * scale * 0.8;
    const legH = layout.leg.height * scale * 0.94;
    const tailW = layout.tail.width * scale * 0.72;
    const tailH = layout.tail.height * scale * 0.72;

    const bodyX = 218;
    const bodyY = 108;

    drawPartBox(parts.tail, {
      x: bodyX - tailW * 0.54,
      y: bodyY + bodyH * 0.02,
      w: tailW,
      h: tailH,
      rotation: -0.36,
    });
    drawPartBox(parts.leg, { x: bodyX + 22, y: bodyY + bodyH * 0.72, w: legW, h: legH });
    drawPartBox(parts.leg, { x: bodyX + 58, y: bodyY + bodyH * 0.72, w: legW, h: legH });
    drawPartBox(parts.body, { x: bodyX, y: bodyY, w: bodyW, h: bodyH, rotation: 0.08 });
    drawPartBox(parts.leg, { x: bodyX + bodyW * 0.68, y: bodyY + bodyH * 0.72, w: legW, h: legH });
    drawPartBox(parts.leg, { x: bodyX + bodyW * 0.88, y: bodyY + bodyH * 0.72, w: legW, h: legH });
    drawPartBox(parts.head, {
      x: bodyX + bodyW * 0.58,
      y: bodyY - headH * 0.26,
      w: headW,
      h: headH,
      rotation: -0.06,
    });

    ctx.fillStyle = 'rgba(223, 246, 255, 0.8)';
    ctx.font = '13px purrabet-regular, sans-serif';
    ctx.fillText('Live in-game body composition preview', 16, 24);
  }, [layout, parts]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: '100%',
        maxWidth: 470,
        borderRadius: 12,
        border: '1px solid rgba(255,255,255,0.16)',
        imageRendering: 'pixelated',
      }}
    />
  );
}

function buildInitialEditorState(initialKitten, initialPartLibrary, initialSelectedParts) {
  const partLibrary = loadInitialPartLibrary(initialPartLibrary);
  return {
    kitten: loadInitialKitten(initialKitten),
    partLibrary,
    selectedParts: loadInitialSelectedParts(initialSelectedParts, partLibrary),
  };
}

const DrawingEditor = ({
  onComplete,
  initialKitten,
  initialPartLibrary,
  initialSelectedParts,
  topBar,
}) => {
  const [initialState] = useState(() => (
    buildInitialEditorState(initialKitten, initialPartLibrary, initialSelectedParts)
  ));

  const [kitten, setKitten] = useState(initialState.kitten);
  const [partLibrary, setPartLibrary] = useState(initialState.partLibrary);
  const [selectedParts, setSelectedParts] = useState(initialState.selectedParts);
  const [customPartCanvases, setCustomPartCanvases] = useState({});

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_KITTEN, JSON.stringify(kitten));
    } catch {
      // Ignore storage errors.
    }
  }, [kitten]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_PART_LIBRARY, JSON.stringify(partLibrary));
    } catch {
      // Ignore storage errors.
    }
  }, [partLibrary]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_SELECTED_PARTS, JSON.stringify(selectedParts));
    } catch {
      // Ignore storage errors.
    }
  }, [selectedParts]);

  useEffect(() => {
    let isCancelled = false;

    const loadCustomCanvases = async () => {
      const nextCanvases = {};

      for (const partKey of PART_KEYS) {
        const selectedId = selectedParts[partKey];
        if (!selectedId) continue;

        const entry = partLibrary[partKey]?.find((item) => item.id === selectedId);
        if (!entry?.dataUrl) continue;

        try {
          nextCanvases[partKey] = await decodeImageToCanvas(entry.dataUrl, partKey);
        } catch {
          // Ignore broken images and fallback to game default for this part.
        }
      }

      if (!isCancelled) {
        setCustomPartCanvases(nextCanvases);
      }
    };

    loadCustomCanvases();

    return () => {
      isCancelled = true;
    };
  }, [partLibrary, selectedParts]);

  const parts = useMemo(() => {
    const output = {};
    PART_KEYS.forEach((partKey) => {
      if (customPartCanvases[partKey]) {
        output[partKey] = customPartCanvases[partKey];
      }
    });
    return output;
  }, [customPartCanvases]);

  const uploadPart = async (partKey, file) => {
    if (!file || !file.type.startsWith('image/')) return;

    try {
      const dataUrl = await readFileAsDataUrl(file);
      const normalizedCanvas = await decodeImageToCanvas(dataUrl, partKey);
      const compressedDataUrl = canvasToCompressedDataUrl(normalizedCanvas);
      const baseName = stripExtension(file.name);

      const newEntry = {
        id: createPartId(),
        name: baseName || 'Custom part',
        dataUrl: compressedDataUrl,
      };

      setPartLibrary((prev) => ({
        ...prev,
        [partKey]: [newEntry, ...(prev[partKey] || [])].slice(0, 40),
      }));

      setSelectedParts((prev) => ({
        ...prev,
        [partKey]: newEntry.id,
      }));
    } catch (error) {
      console.warn('[Editor] Failed to upload part image', error);
    }
  };

  const choosePart = (partKey, partId) => {
    setSelectedParts((prev) => ({
      ...prev,
      [partKey]: partId,
    }));
  };

  const removePart = (partKey, partId) => {
    const target = (partLibrary[partKey] || []).find((item) => item.id === partId);
    if (target?.isSystemDefault) return;

    setPartLibrary((prev) => ({
      ...prev,
      [partKey]: (prev[partKey] || []).filter((item) => item.id !== partId),
    }));

    setSelectedParts((prev) => {
      if (prev[partKey] !== partId) return prev;
      return {
        ...prev,
        [partKey]: null,
      };
    });
  };

  const partSourceLabel = (partKey) => {
    const selectedId = selectedParts[partKey];
    if (!selectedId) return 'Game default';

    const selected = (partLibrary[partKey] || []).find((item) => item.id === selectedId);
    if (!selected) return 'Game default';
    if (selected.isSystemDefault) return 'System default';
    return 'Selected image';
  };

  const handleComplete = () => {
    onComplete({
      parts,
      kitten,
      selectedParts,
      partLibrary,
    });
  };

  return (
    <div style={s.wrapper}>
      {topBar}

      <div style={s.headerRow}>
        <h1 style={s.title}>Kitten Builder</h1>
        <p style={s.subtitle}>Upload your own part images, set defaults, then preview the full kitten before entering the room.</p>
      </div>

      <div style={s.layout}>
        <div style={s.panel}>
          <label style={s.label}>Kitten name</label>
          <input
            type="text"
            value={kitten.name || ''}
            onChange={(event) => setKitten((prev) => ({ ...prev, name: event.target.value.slice(0, 24) }))}
            style={s.input}
            placeholder="Your kitten"
          />

          <div style={s.customSection}>
            <h3 style={s.customHeading}>Body part image library</h3>
            <p style={s.customHint}>Only your uploaded/default images are used. Missing parts fallback to the in-game skeleton default.</p>

            {PART_KEYS.map((partKey) => {
              const list = partLibrary[partKey] || [];
              const selectedId = selectedParts[partKey];

              return (
                <div key={partKey} style={s.customPartCard}>
                  <div style={s.customPartHeader}>
                    <strong>{PART_LABELS[partKey]}</strong>
                    <label style={s.uploadBtn}>
                      Add image
                      <input
                        type="file"
                        accept="image/png,image/webp,image/jpeg"
                        style={s.hiddenInput}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          uploadPart(partKey, file);
                          event.target.value = '';
                        }}
                      />
                    </label>
                  </div>

                  <div style={s.choiceRow}>
                    <button
                      type="button"
                      style={{
                        ...s.generatedChoice,
                        ...(selectedId ? null : s.generatedChoiceActive),
                      }}
                      onClick={() => choosePart(partKey, null)}
                    >
                      Use game default
                    </button>

                    {list.map((item) => {
                      const isSelected = item.id === selectedId;

                      return (
                        <div key={item.id} style={s.choiceItemWrap}>
                          <button
                            type="button"
                            style={{
                              ...s.choiceItem,
                              ...(isSelected ? s.choiceItemActive : null),
                            }}
                            onClick={() => choosePart(partKey, item.id)}
                            title={item.name}
                          >
                            <img src={item.dataUrl} alt={item.name} style={s.choiceImg} />
                            <span style={s.choiceLabel}>{item.name}</span>
                          </button>
                          {item.isSystemDefault ? (
                            <span style={s.defaultTag}>Default</span>
                          ) : (
                            <button
                              type="button"
                              style={s.removeChoiceBtn}
                              onClick={() => removePart(partKey, item.id)}
                              title="Delete from library"
                            >
                              X
                            </button>
                          )}
                        </div>
                      );
                    })}

                    {list.length === 0 && (
                      <span style={s.emptyChoiceHint}>No images yet. Upload your own files for this part.</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div style={s.actionsRow}>
            <button style={s.primaryBtn} onClick={handleComplete}>Play as this kitten</button>
          </div>
        </div>

        <div style={s.previewPanel}>
          <h2 style={s.previewHeading}>Full kitten preview</h2>
          <p style={s.previewHint}>This combines all selected parts so you can see the full in-game look before saving.</p>

          <FullKittenPreview parts={parts} />

          <h3 style={s.previewSubheading}>Part previews</h3>
          <div style={s.previewGrid}>
            <CanvasPreview title="Head" sourceCanvas={parts.head} sourceLabel={partSourceLabel('head')} />
            <CanvasPreview title="Body" sourceCanvas={parts.body} sourceLabel={partSourceLabel('body')} />
            <CanvasPreview title="Leg" sourceCanvas={parts.leg} sourceLabel={partSourceLabel('leg')} />
            <CanvasPreview title="Tail" sourceCanvas={parts.tail} sourceLabel={partSourceLabel('tail')} />
          </div>
        </div>
      </div>
    </div>
  );
};

const s = {
  wrapper: {
    height: '100dvh',
    background: 'transparent',
    color: '#edf0ff',
    fontFamily: '"purrabet-regular", sans-serif',
    padding: '20px',
    paddingBottom: '34px',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    overflowY: 'auto',
    WebkitOverflowScrolling: 'touch',
  },
  headerRow: {
    maxWidth: 1180,
    width: '100%',
    margin: '0 auto',
  },
  title: {
    margin: 0,
    fontSize: '2rem',
    letterSpacing: '0.03em',
  },
  subtitle: {
    marginTop: 6,
    marginBottom: 0,
    opacity: 0.75,
  },
  layout: {
    width: '100%',
    maxWidth: 1180,
    margin: '0 auto',
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
    gap: 16,
    alignItems: 'start',
  },
  panel: {
    background: 'rgba(9,10,17,0.5)',
    border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: 14,
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  label: {
    fontSize: 13,
    opacity: 0.85,
  },
  input: {
    background: '#121727',
    color: '#f0f4ff',
    border: '1px solid rgba(255,255,255,0.2)',
    borderRadius: 8,
    padding: '8px 10px',
    fontSize: 14,
  },
  customSection: {
    marginTop: 6,
    padding: 10,
    borderRadius: 10,
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.12)',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    maxHeight: '60vh',
    overflowY: 'auto',
    WebkitOverflowScrolling: 'touch',
  },
  customHeading: {
    margin: 0,
    fontSize: 15,
  },
  customHint: {
    margin: 0,
    fontSize: 12,
    opacity: 0.75,
  },
  customPartCard: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    padding: 8,
    borderRadius: 10,
    background: 'rgba(0,0,0,0.2)',
    border: '1px solid rgba(255,255,255,0.1)',
  },
  customPartHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  uploadBtn: {
    background: 'rgba(100,200,255,0.2)',
    border: '1px solid rgba(100,200,255,0.45)',
    borderRadius: 8,
    padding: '6px 10px',
    fontSize: 12,
    cursor: 'pointer',
    color: '#dff7ff',
    fontWeight: 700,
  },
  hiddenInput: {
    display: 'none',
  },
  choiceRow: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  generatedChoice: {
    border: '1px solid rgba(255,255,255,0.22)',
    background: 'rgba(255,255,255,0.05)',
    color: '#eef3ff',
    borderRadius: 8,
    padding: '8px 10px',
    fontSize: 12,
    cursor: 'pointer',
  },
  generatedChoiceActive: {
    border: '1px solid rgba(86,231,143,0.8)',
    boxShadow: '0 0 0 2px rgba(86,231,143,0.25) inset',
  },
  choiceItemWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  choiceItem: {
    border: '1px solid rgba(255,255,255,0.22)',
    background: 'rgba(255,255,255,0.04)',
    borderRadius: 8,
    padding: 6,
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
    width: 84,
  },
  choiceItemActive: {
    border: '1px solid rgba(86,231,143,0.8)',
    boxShadow: '0 0 0 2px rgba(86,231,143,0.22) inset',
  },
  choiceImg: {
    width: 56,
    height: 56,
    objectFit: 'contain',
    imageRendering: 'pixelated',
    borderRadius: 6,
    background: 'linear-gradient(45deg, #555 25%, #777 25%, #777 50%, #555 50%, #555 75%, #777 75%, #777 100%)',
    backgroundSize: '12px 12px',
  },
  choiceLabel: {
    fontSize: 10,
    lineHeight: 1.1,
    maxWidth: '100%',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  removeChoiceBtn: {
    border: '1px solid rgba(255,120,120,0.4)',
    background: 'rgba(255,120,120,0.15)',
    color: '#ffdede',
    borderRadius: 8,
    width: 24,
    height: 24,
    fontSize: 10,
    cursor: 'pointer',
  },
  defaultTag: {
    fontSize: 10,
    lineHeight: '24px',
    minWidth: 40,
    textAlign: 'center',
    borderRadius: 8,
    border: '1px solid rgba(123, 226, 255, 0.42)',
    background: 'rgba(123, 226, 255, 0.16)',
    color: '#d9f7ff',
    padding: '0 6px',
    boxSizing: 'border-box',
  },
  emptyChoiceHint: {
    fontSize: 12,
    opacity: 0.65,
  },
  actionsRow: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    marginTop: 6,
  },
  primaryBtn: {
    flex: '1 1 220px',
    background: 'linear-gradient(135deg, #56e78f 0%, #3ec8cb 100%)',
    color: '#09101f',
    border: 'none',
    borderRadius: 10,
    padding: '10px 14px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  previewPanel: {
    background: 'rgba(9,10,17,0.5)',
    border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: 14,
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  previewHeading: {
    margin: 0,
    fontSize: '1.1rem',
  },
  previewSubheading: {
    margin: 0,
    marginTop: 2,
    fontSize: '1rem',
  },
  previewHint: {
    margin: 0,
    opacity: 0.7,
    fontSize: 13,
  },
  previewGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
    gap: 10,
  },
  previewCard: {
    background: 'rgba(255,255,255,0.03)',
    borderRadius: 12,
    padding: 10,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 6,
  },
  previewTitle: {
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    opacity: 0.75,
  },
  previewSource: {
    fontSize: 11,
    opacity: 0.65,
  },
};

export default DrawingEditor;
