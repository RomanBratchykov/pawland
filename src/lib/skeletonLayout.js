const FALLBACK_LAYOUT = {
  head: { x: 51.57, y: 19.45, rotation: -33.13, width: 243, height: 223 },
  body: { x: 0, y: 0, rotation: 0, width: 196, height: 210 },
  leg: { x: 18.55, y: 0.09, rotation: 75.12, width: 57, height: 84 },
  tail: { x: 0, y: 0, rotation: 0, width: 207, height: 220 },
};

let layoutCache = null;
let loadingPromise = null;

function pickDefaultSkin(raw) {
  if (!Array.isArray(raw?.skins) || raw.skins.length === 0) return null;
  return raw.skins.find((skin) => skin?.name === 'default') || raw.skins[0];
}

function readAttachment(attachmentsRoot, slotName, attachmentName) {
  const slotAttachments = attachmentsRoot?.[slotName];
  if (!slotAttachments || typeof slotAttachments !== 'object') return null;

  if (attachmentName && slotAttachments[attachmentName]) {
    return slotAttachments[attachmentName];
  }

  const first = Object.values(slotAttachments)[0];
  return first && typeof first === 'object' ? first : null;
}

function normalizeAttachment(attachment, fallback) {
  return {
    x: Number.isFinite(attachment?.x) ? attachment.x : fallback.x,
    y: Number.isFinite(attachment?.y) ? attachment.y : fallback.y,
    rotation: Number.isFinite(attachment?.rotation) ? attachment.rotation : fallback.rotation,
    width: Number.isFinite(attachment?.width) ? attachment.width : fallback.width,
    height: Number.isFinite(attachment?.height) ? attachment.height : fallback.height,
  };
}

function buildLayout(rawSkeleton) {
  const skin = pickDefaultSkin(rawSkeleton);
  const attachments = skin?.attachments || {};

  const headAtt = readAttachment(attachments, 'head', 'head');
  const bodyAtt = readAttachment(attachments, 'body', 'body');
  const legAtt = readAttachment(attachments, 'leg', 'leg');
  const tailAtt = readAttachment(attachments, 'tail', 'tail');

  return {
    head: normalizeAttachment(headAtt, FALLBACK_LAYOUT.head),
    body: normalizeAttachment(bodyAtt, FALLBACK_LAYOUT.body),
    leg: normalizeAttachment(legAtt, FALLBACK_LAYOUT.leg),
    tail: normalizeAttachment(tailAtt, FALLBACK_LAYOUT.tail),
  };
}

export async function loadSkeletonLayout() {
  if (layoutCache) return layoutCache;
  if (loadingPromise) return loadingPromise;

  loadingPromise = fetch('/assets/skeleton.json')
    .then(async (response) => {
      if (!response.ok) throw new Error('Failed to fetch skeleton.json');
      const raw = await response.json();
      layoutCache = buildLayout(raw);
      return layoutCache;
    })
    .catch((error) => {
      console.warn('[SkeletonLayout] Using fallback attachment layout', error);
      layoutCache = FALLBACK_LAYOUT;
      return layoutCache;
    })
    .finally(() => {
      loadingPromise = null;
    });

  return loadingPromise;
}

export function getFallbackSkeletonLayout() {
  return FALLBACK_LAYOUT;
}
