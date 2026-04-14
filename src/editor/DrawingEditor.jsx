import React, { useEffect, useMemo, useRef, useState } from 'react';

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

const FUR_PRESETS = [
  {
    name: 'Ginger',
    fur: '#d89b55',
    belly: '#f7e8cc',
    pattern: '#9b6231',
    eye: '#58b7ff',
    ear: '#f9b5bf',
  },
  {
    name: 'Smoky',
    fur: '#8b8c98',
    belly: '#d8dbe3',
    pattern: '#5f6471',
    eye: '#8af0d8',
    ear: '#ffc5d0',
  },
  {
    name: 'Midnight',
    fur: '#2e3342',
    belly: '#6f7686',
    pattern: '#1c2230',
    eye: '#d5ff7a',
    ear: '#ff8ea9',
  },
  {
    name: 'Latte',
    fur: '#c9ae8b',
    belly: '#f4e8d8',
    pattern: '#9f7f59',
    eye: '#6fddff',
    ear: '#f4b0b8',
  },
];

const PATTERN_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'stripes', label: 'Stripes' },
  { value: 'spots', label: 'Spots' },
];

const EYE_OPTIONS = [
  { value: 'round', label: 'Round' },
  { value: 'sleepy', label: 'Sleepy' },
  { value: 'big', label: 'Big' },
];

const DEFAULT_KITTEN = {
  name: 'Mochi',
  furColor: FUR_PRESETS[0].fur,
  bellyColor: FUR_PRESETS[0].belly,
  patternColor: FUR_PRESETS[0].pattern,
  eyeColor: FUR_PRESETS[0].eye,
  earColor: FUR_PRESETS[0].ear,
  patternType: 'stripes',
  eyeStyle: 'round',
  hasSocks: true,
  hasTailTip: true,
};

const STORAGE_KEY_KITTEN = 'catGame.kittenBuilder.v1';
const STORAGE_KEY_PART_LIBRARY = 'catGame.kittenPartLibrary.v1';
const STORAGE_KEY_SELECTED_PARTS = 'catGame.kittenSelectedParts.v1';

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

function decodeImageToCanvas(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => {
      const maxSide = 512;
      const ratio = Math.min(1, maxSide / Math.max(image.width, image.height));
      const targetW = Math.max(1, Math.round(image.width * ratio));
      const targetH = Math.max(1, Math.round(image.height * ratio));

      const canvas = createCanvas(targetW, targetH);
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, targetW, targetH);
      ctx.drawImage(image, 0, 0, targetW, targetH);
      resolve(canvas);
    };

    image.onerror = () => reject(new Error('Image decode failed'));
    image.src = dataUrl;
  });
}

function hexToRgb(hex) {
  const value = hex.replace('#', '');
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

function shade(hex, amount) {
  const rgb = hexToRgb(hex);
  const clamp = (n) => Math.max(0, Math.min(255, n));
  const r = clamp(rgb.r + amount);
  const g = clamp(rgb.g + amount);
  const b = clamp(rgb.b + amount);
  return `rgb(${r}, ${g}, ${b})`;
}

function drawCheckerboard(ctx, w, h, tile = 10) {
  for (let y = 0; y < h; y += tile) {
    for (let x = 0; x < w; x += tile) {
      ctx.fillStyle = ((x + y) / tile) % 2 === 0 ? '#d7d7d7' : '#bdbdbd';
      ctx.fillRect(x, y, tile, tile);
    }
  }
}

function drawPattern(ctx, type, color, w, h, seed = 0) {
  if (type === 'none') return;

  if (type === 'stripes') {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 8;
    ctx.globalAlpha = 0.45;
    for (let i = -1; i < 7; i++) {
      const x = (w / 6) * i + (seed % 2 ? 6 : 0);
      ctx.beginPath();
      ctx.moveTo(x, h * 0.15);
      ctx.quadraticCurveTo(x + 16, h * 0.45, x - 12, h * 0.8);
      ctx.stroke();
    }
    ctx.restore();
    return;
  }

  if (type === 'spots') {
    ctx.save();
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.38;
    for (let i = 0; i < 7; i++) {
      const rx = 10 + ((i * 29 + seed * 17) % (w - 20));
      const ry = 12 + ((i * 21 + seed * 31) % (h - 24));
      const rw = 7 + ((i * 7) % 14);
      const rh = 6 + ((i * 9) % 13);
      ctx.beginPath();
      ctx.ellipse(rx, ry, rw, rh, (i * Math.PI) / 6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

function roundedRectPath(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawHeadPart(ctx, cfg) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;

  const outline = shade(cfg.furColor, -25);

  ctx.clearRect(0, 0, w, h);

  ctx.fillStyle = cfg.furColor;
  ctx.beginPath();
  ctx.moveTo(54, 74);
  ctx.lineTo(76, 30);
  ctx.lineTo(104, 74);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(146, 74);
  ctx.lineTo(124, 30);
  ctx.lineTo(96, 74);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = cfg.earColor;
  ctx.beginPath();
  ctx.moveTo(67, 69);
  ctx.lineTo(78, 45);
  ctx.lineTo(93, 69);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(133, 69);
  ctx.lineTo(122, 45);
  ctx.lineTo(107, 69);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = cfg.furColor;
  ctx.beginPath();
  ctx.ellipse(100, 112, 67, 56, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.ellipse(100, 112, 67, 56, 0, 0, Math.PI * 2);
  ctx.clip();
  drawPattern(ctx, cfg.patternType, cfg.patternColor, 130, 110, 2);
  ctx.restore();

  ctx.fillStyle = cfg.bellyColor;
  ctx.beginPath();
  ctx.ellipse(100, 128, 34, 22, 0, 0, Math.PI * 2);
  ctx.fill();

  const eyeY = cfg.eyeStyle === 'sleepy' ? 101 : 104;
  const eyeRX = cfg.eyeStyle === 'big' ? 9 : 7;
  const eyeRY = cfg.eyeStyle === 'sleepy' ? 3 : cfg.eyeStyle === 'big' ? 12 : 10;

  ctx.fillStyle = '#151515';
  ctx.beginPath();
  ctx.ellipse(78, eyeY, eyeRX, eyeRY, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(122, eyeY, eyeRX, eyeRY, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = cfg.eyeColor;
  const irisRY = cfg.eyeStyle === 'sleepy' ? 2 : eyeRY - 2;
  ctx.beginPath();
  ctx.ellipse(78, eyeY, Math.max(4, eyeRX - 2), Math.max(1.5, irisRY), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(122, eyeY, Math.max(4, eyeRX - 2), Math.max(1.5, irisRY), 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#ff7d9f';
  ctx.beginPath();
  ctx.moveTo(100, 114);
  ctx.lineTo(95, 120);
  ctx.lineTo(105, 120);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = outline;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.ellipse(100, 112, 67, 56, 0, 0, Math.PI * 2);
  ctx.stroke();
}

function drawBodyPart(ctx, cfg) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;

  ctx.clearRect(0, 0, w, h);

  ctx.fillStyle = cfg.furColor;
  ctx.beginPath();
  ctx.ellipse(90, 82, 70, 62, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.ellipse(90, 82, 70, 62, 0, 0, Math.PI * 2);
  ctx.clip();
  drawPattern(ctx, cfg.patternType, cfg.patternColor, 180, 160, 4);
  ctx.restore();

  ctx.fillStyle = cfg.bellyColor;
  ctx.beginPath();
  ctx.ellipse(95, 93, 40, 36, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = shade(cfg.furColor, -22);
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.ellipse(90, 82, 70, 62, 0, 0, Math.PI * 2);
  ctx.stroke();
}

function drawLegPart(ctx, cfg) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;

  ctx.clearRect(0, 0, w, h);

  ctx.fillStyle = cfg.furColor;
  ctx.beginPath();
  roundedRectPath(ctx, 18, 18, 44, 95, 18);
  ctx.fill();

  if (cfg.hasSocks) {
    ctx.fillStyle = cfg.bellyColor;
    ctx.beginPath();
    roundedRectPath(ctx, 18, 78, 44, 35, 14);
    ctx.fill();
  }

  if (cfg.patternType !== 'none') {
    ctx.strokeStyle = cfg.patternColor;
    ctx.globalAlpha = 0.4;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(25, 34);
    ctx.quadraticCurveTo(36, 48, 26, 63);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  ctx.strokeStyle = shade(cfg.furColor, -20);
  ctx.lineWidth = 4;
  ctx.beginPath();
  roundedRectPath(ctx, 18, 18, 44, 95, 18);
  ctx.stroke();
}

function drawTailPart(ctx, cfg) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;

  ctx.clearRect(0, 0, w, h);

  ctx.strokeStyle = cfg.furColor;
  ctx.lineWidth = 34;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(40, 184);
  ctx.bezierCurveTo(27, 145, 18, 93, 43, 56);
  ctx.stroke();

  if (cfg.hasTailTip) {
    ctx.strokeStyle = cfg.bellyColor;
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.moveTo(43, 64);
    ctx.bezierCurveTo(39, 55, 36, 46, 44, 38);
    ctx.stroke();
  }

  if (cfg.patternType !== 'none') {
    ctx.strokeStyle = cfg.patternColor;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 8;
    for (let y = 170; y >= 84; y -= 26) {
      ctx.beginPath();
      ctx.moveTo(30, y);
      ctx.quadraticCurveTo(40, y - 5, 52, y - 16);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}

function buildKittenParts(config) {
  const [headW, headH] = PART_SIZES.head;
  const [bodyW, bodyH] = PART_SIZES.body;
  const [legW, legH] = PART_SIZES.leg;
  const [tailW, tailH] = PART_SIZES.tail;

  const head = createCanvas(headW, headH);
  const body = createCanvas(bodyW, bodyH);
  const leg = createCanvas(legW, legH);
  const tail = createCanvas(tailW, tailH);

  drawHeadPart(head.getContext('2d'), config);
  drawBodyPart(body.getContext('2d'), config);
  drawLegPart(leg.getContext('2d'), config);
  drawTailPart(tail.getContext('2d'), config);

  return { head, body, leg, tail };
}

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
    const result = createEmptyPartLibrary();
    PART_KEYS.forEach((partKey) => {
      const list = Array.isArray(initialPartLibrary?.[partKey]) ? initialPartLibrary[partKey] : [];
      result[partKey] = list
        .filter((item) => item && typeof item.id === 'string' && typeof item.dataUrl === 'string')
        .map((item) => ({
          id: item.id,
          name: typeof item.name === 'string' ? item.name : 'Custom part',
          dataUrl: item.dataUrl,
        }));
    });
    return result;
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY_PART_LIBRARY);
    if (!raw) return createEmptyPartLibrary();

    const parsed = JSON.parse(raw);
    const result = createEmptyPartLibrary();

    PART_KEYS.forEach((partKey) => {
      const list = Array.isArray(parsed?.[partKey]) ? parsed[partKey] : [];
      result[partKey] = list
        .filter((item) => item && typeof item.id === 'string' && typeof item.dataUrl === 'string')
        .map((item) => ({
          id: item.id,
          name: typeof item.name === 'string' ? item.name : 'Custom part',
          dataUrl: item.dataUrl,
        }));
    });

    return result;
  } catch {
    return createEmptyPartLibrary();
  }
}

function loadInitialSelectedParts(initialSelectedParts = null) {
  if (initialSelectedParts) {
    return {
      head: typeof initialSelectedParts?.head === 'string' ? initialSelectedParts.head : null,
      body: typeof initialSelectedParts?.body === 'string' ? initialSelectedParts.body : null,
      leg: typeof initialSelectedParts?.leg === 'string' ? initialSelectedParts.leg : null,
      tail: typeof initialSelectedParts?.tail === 'string' ? initialSelectedParts.tail : null,
    };
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY_SELECTED_PARTS);
    if (!raw) return createEmptySelectedParts();
    const parsed = JSON.parse(raw);

    return {
      head: typeof parsed?.head === 'string' ? parsed.head : null,
      body: typeof parsed?.body === 'string' ? parsed.body : null,
      leg: typeof parsed?.leg === 'string' ? parsed.leg : null,
      tail: typeof parsed?.tail === 'string' ? parsed.tail : null,
    };
  } catch {
    return createEmptySelectedParts();
  }
}

function randomFrom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function CanvasPreview({ title, sourceCanvas, sourceLabel }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !sourceCanvas) return;
    canvas.width = sourceCanvas.width;
    canvas.height = sourceCanvas.height;
    const ctx = canvas.getContext('2d');
    drawCheckerboard(ctx, canvas.width, canvas.height, 10);
    ctx.drawImage(sourceCanvas, 0, 0);
  }, [sourceCanvas]);

  return (
    <div style={s.previewCard}>
      <span style={s.previewTitle}>{title}</span>
      <span style={s.previewSource}>{sourceLabel}</span>
      <canvas
        ref={canvasRef}
        style={{
          width: Math.max(100, sourceCanvas.width * 0.75),
          height: Math.max(100, sourceCanvas.height * 0.75),
          imageRendering: 'pixelated',
          borderRadius: 10,
          border: '1px solid rgba(255,255,255,0.2)',
        }}
      />
    </div>
  );
}

const DrawingEditor = ({
  onComplete,
  initialKitten,
  initialPartLibrary,
  initialSelectedParts,
  topBar,
}) => {
  const [kitten, setKitten] = useState(() => loadInitialKitten(initialKitten));
  const [partLibrary, setPartLibrary] = useState(() => loadInitialPartLibrary(initialPartLibrary));
  const [selectedParts, setSelectedParts] = useState(() => loadInitialSelectedParts(initialSelectedParts));
  const [customPartCanvases, setCustomPartCanvases] = useState({});

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_KITTEN, JSON.stringify(kitten));
  }, [kitten]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_PART_LIBRARY, JSON.stringify(partLibrary));
  }, [partLibrary]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_SELECTED_PARTS, JSON.stringify(selectedParts));
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
          nextCanvases[partKey] = await decodeImageToCanvas(entry.dataUrl);
        } catch {
          // Ignore broken images and keep generated part instead.
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

  const generatedParts = useMemo(() => buildKittenParts(kitten), [kitten]);

  const parts = useMemo(() => {
    return {
      ...generatedParts,
      ...customPartCanvases,
    };
  }, [generatedParts, customPartCanvases]);

  const setField = (key, value) => {
    setKitten((prev) => ({ ...prev, [key]: value }));
  };

  const applyPreset = (preset) => {
    setKitten((prev) => ({
      ...prev,
      furColor: preset.fur,
      bellyColor: preset.belly,
      patternColor: preset.pattern,
      eyeColor: preset.eye,
      earColor: preset.ear,
    }));
  };

  const randomize = () => {
    const preset = randomFrom(FUR_PRESETS);
    setKitten((prev) => ({
      ...prev,
      furColor: preset.fur,
      bellyColor: preset.belly,
      patternColor: preset.pattern,
      eyeColor: preset.eye,
      earColor: preset.ear,
      patternType: randomFrom(PATTERN_OPTIONS).value,
      eyeStyle: randomFrom(EYE_OPTIONS).value,
      hasSocks: Math.random() > 0.35,
      hasTailTip: Math.random() > 0.35,
    }));
  };

  const resetToDefault = () => {
    setKitten(DEFAULT_KITTEN);
  };

  const uploadPart = async (partKey, file) => {
    if (!file || !file.type.startsWith('image/')) return;

    try {
      const dataUrl = await readFileAsDataUrl(file);
      const baseName = file.name.replace(/\.[^/.]+$/, '');

      const newEntry = {
        id: createPartId(),
        name: baseName || 'Custom part',
        dataUrl,
      };

      setPartLibrary((prev) => ({
        ...prev,
        [partKey]: [newEntry, ...(prev[partKey] || [])].slice(0, 20),
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
    if (!selectedId) return 'Generated';
    const exists = (partLibrary[partKey] || []).some((item) => item.id === selectedId);
    return exists ? 'Custom' : 'Generated';
  };

  const handleComplete = () => {
    console.log('[Editor] Kitten generated, entering game');
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
        <p style={s.subtitle}>Create your kitten skin, scroll through options, then enter the online room.</p>
      </div>

      <div style={s.presetRow}>
        {FUR_PRESETS.map((preset) => (
          <button
            key={preset.name}
            style={{ ...s.presetBtn, background: preset.fur }}
            onClick={() => applyPreset(preset)}
            title={`Apply ${preset.name}`}
          >
            {preset.name}
          </button>
        ))}
      </div>

      <div style={s.layout}>
        <div style={s.panel}>
          <label style={s.label}>Kitten name</label>
          <input
            type="text"
            value={kitten.name}
            onChange={(e) => setField('name', e.target.value.slice(0, 24))}
            style={s.input}
            placeholder="Your kitten"
          />

          <div style={s.colorsGrid}>
            <label style={s.colorField}><span>Fur</span><input type="color" value={kitten.furColor} onChange={(e) => setField('furColor', e.target.value)} /></label>
            <label style={s.colorField}><span>Belly</span><input type="color" value={kitten.bellyColor} onChange={(e) => setField('bellyColor', e.target.value)} /></label>
            <label style={s.colorField}><span>Pattern</span><input type="color" value={kitten.patternColor} onChange={(e) => setField('patternColor', e.target.value)} /></label>
            <label style={s.colorField}><span>Eyes</span><input type="color" value={kitten.eyeColor} onChange={(e) => setField('eyeColor', e.target.value)} /></label>
            <label style={s.colorField}><span>Ear inside</span><input type="color" value={kitten.earColor} onChange={(e) => setField('earColor', e.target.value)} /></label>
          </div>

          <label style={s.label}>Pattern</label>
          <select
            value={kitten.patternType}
            onChange={(e) => setField('patternType', e.target.value)}
            style={s.input}
          >
            {PATTERN_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>

          <label style={s.label}>Eyes style</label>
          <select
            value={kitten.eyeStyle}
            onChange={(e) => setField('eyeStyle', e.target.value)}
            style={s.input}
          >
            {EYE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>

          <label style={s.toggleRow}>
            <input
              type="checkbox"
              checked={kitten.hasSocks}
              onChange={(e) => setField('hasSocks', e.target.checked)}
            />
            White socks on paws
          </label>

          <label style={s.toggleRow}>
            <input
              type="checkbox"
              checked={kitten.hasTailTip}
              onChange={(e) => setField('hasTailTip', e.target.checked)}
            />
            Light tail tip
          </label>

          <div style={s.customSection}>
            <h3 style={s.customHeading}>Your drawn skin parts</h3>
            <p style={s.customHint}>Upload transparent PNG files and pick which one to use for each body part.</p>

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
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          uploadPart(partKey, file);
                          e.target.value = '';
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
                      Use generated
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
                          <button
                            type="button"
                            style={s.removeChoiceBtn}
                            onClick={() => removePart(partKey, item.id)}
                            title="Delete from library"
                          >
                            X
                          </button>
                        </div>
                      );
                    })}

                    {list.length === 0 && (
                      <span style={s.emptyChoiceHint}>No uploaded items yet</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div style={s.actionsRow}>
            <button style={s.secondaryBtn} onClick={randomize}>Random</button>
            <button style={s.secondaryBtn} onClick={resetToDefault}>Reset</button>
            <button style={s.primaryBtn} onClick={handleComplete}>Play as this kitten</button>
          </div>
        </div>

        <div style={s.previewPanel}>
          <h2 style={s.previewHeading}>Preview parts</h2>
          <p style={s.previewHint}>These canvases are applied directly to the current Spine skeleton.</p>

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
    maxWidth: 1100,
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
  presetRow: {
    maxWidth: 1100,
    width: '100%',
    margin: '0 auto',
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
  },
  presetBtn: {
    border: '1px solid rgba(255,255,255,0.35)',
    color: '#0d111e',
    fontWeight: 700,
    borderRadius: 10,
    padding: '8px 12px',
    cursor: 'pointer',
    minWidth: 84,
  },
  layout: {
    width: '100%',
    maxWidth: 1100,
    margin: '0 auto',
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
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
  colorsGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 8,
  },
  colorField: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: 13,
    gap: 8,
  },
  toggleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 14,
    opacity: 0.95,
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
    maxHeight: '44vh',
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
    width: 82,
  },
  choiceItemActive: {
    border: '1px solid rgba(86,231,143,0.8)',
    boxShadow: '0 0 0 2px rgba(86,231,143,0.22) inset',
  },
  choiceImg: {
    width: 54,
    height: 54,
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
    flex: '1 1 180px',
    background: 'linear-gradient(135deg, #56e78f 0%, #3ec8cb 100%)',
    color: '#09101f',
    border: 'none',
    borderRadius: 10,
    padding: '10px 14px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  secondaryBtn: {
    background: 'rgba(255,255,255,0.11)',
    color: '#f0f4ff',
    border: '1px solid rgba(255,255,255,0.25)',
    borderRadius: 10,
    padding: '10px 12px',
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