/* (c) Copyright Unitiveapp, all rights reserved. */

/**
 * IDML (InDesign Markup Language) → SmartTemplate parser.
 *
 * IDML is a ZIP archive:
 *   designmap.xml       – document entry point (spread refs, dimensions)
 *   Spreads/*.xml       – page geometry (TextFrame, Rectangle, Oval, GraphicFrame, Group)
 *   Stories/*.xml       – text content + character/paragraph style ranges
 *   Resources/Styles.xml – named styles (ParagraphStyle, CharacterStyle → brand colors/fonts)
 *
 * Naming conventions (same as PSD):
 *   !LayerName  → brand-locked (all LockFlags = true)
 *   LayerName*  → required field
 *
 * InDesign coordinate system:
 *   @GeometricBounds = "top left bottom right" in points (1 pt = 1 px at 72 PPI screen)
 *   @ItemTransform   = "a b c d tx ty" transformation matrix (we extract tx/ty for position)
 */

import JSZip from 'jszip';
import { DOMParser } from 'xmldom';
import { v4 as uuidv4 } from 'uuid';
import type {
    BrandColor,
    BrandFont,
    BrandGuardrails,
    Layer,
    LayerConstraints,
    LayerProperties,
    LockFlags,
    SmartTemplate,
    Transform,
} from '../types/SmartTemplate';

// ─── Constants ────────────────────────────────────────────────────────────────

/** InDesign uses 72 PPI internally; we convert to screen pixels (96 PPI). */
const PT_TO_PX = 96 / 72;

const DEFAULT_LOCK: LockFlags = {
    position: false, size: false, rotation: false,
    opacity: false, color: false, font: false, content: false, hidden: false,
};

const FULL_LOCK: LockFlags = {
    position: true, size: true, rotation: true,
    opacity: true, color: true, font: true, content: true, hidden: false,
};

// ─── XML Helpers ──────────────────────────────────────────────────────────────

function parseXml(text: string): Document {
    return new DOMParser().parseFromString(text, 'text/xml');
}

function attr(el: Element, name: string): string {
    return el.getAttribute(name) ?? '';
}

function childrenOf(el: Element | Document, tagName: string): Element[] {
    const result: Element[] = [];
    const nodes = el.getElementsByTagName(tagName);
    for (let i = 0; i < nodes.length; i++) result.push(nodes[i] as Element);
    return result;
}

// ─── Colour Conversion ────────────────────────────────────────────────────────

/** InDesign color refs look like "Color/C=0 M=0 Y=0 K=0" or "Color/Black" */
function cmykToHex(c: number, m: number, y: number, k: number): string {
    const r = Math.round(255 * (1 - c / 100) * (1 - k / 100));
    const g = Math.round(255 * (1 - m / 100) * (1 - k / 100));
    const b = Math.round(255 * (1 - y / 100) * (1 - k / 100));
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function resolveColorRef(ref: string): string | null {
    // e.g. "Color/C=0 M=100 Y=100 K=0"
    const cmyk = ref.match(/C=(\d+\.?\d*)\s+M=(\d+\.?\d*)\s+Y=(\d+\.?\d*)\s+K=(\d+\.?\d*)/);
    if (cmyk) return cmykToHex(parseFloat(cmyk[1]), parseFloat(cmyk[2]), parseFloat(cmyk[3]), parseFloat(cmyk[4]));
    if (ref.includes('Black') || ref === 'Color/Black') return '#000000';
    if (ref.includes('White') || ref === 'Color/White') return '#ffffff';
    if (ref.includes('Paper')) return '#ffffff';
    if (ref.includes('None') || ref === 'Swatch/None') return null;
    return '#000000';
}

// ─── Transform Helpers ────────────────────────────────────────────────────────

/**
 * @GeometricBounds = "top left bottom right" (points)
 * @ItemTransform   = "a b c d tx ty" (affine matrix, tx/ty = translation in points)
 */
function buildTransformFromBounds(boundsStr: string, transformStr: string): Transform {
    const [top, left, bottom, right] = boundsStr.split(' ').map(parseFloat);
    const matrix = transformStr.split(' ').map(parseFloat);
    const tx = isNaN(matrix[4]) ? 0 : matrix[4];
    const ty = isNaN(matrix[5]) ? 0 : matrix[5];

    // GeometricBounds is in the item's local frame; apply translation from ItemTransform
    const x = Math.round((left + tx) * PT_TO_PX);
    const y = Math.round((top + ty) * PT_TO_PX);
    const width = Math.round(Math.abs(right - left) * PT_TO_PX);
    const height = Math.round(Math.abs(bottom - top) * PT_TO_PX);

    // Rotation from matrix (a=cos θ, b=sin θ)
    const rotation = Math.round(Math.atan2(matrix[1] ?? 0, matrix[0] ?? 1) * (180 / Math.PI));

    return { x, y, width: Math.max(width, 1), height: Math.max(height, 1), rotation, scaleX: 1, scaleY: 1 };
}

// ─── Layer Constraints ────────────────────────────────────────────────────────

function buildConstraints(name: string, visible: boolean): LayerConstraints {
    const isLocked = name.startsWith('!');
    const isRequired = name.endsWith('*');
    return {
        locked: isLocked ? FULL_LOCK : { ...DEFAULT_LOCK, hidden: !visible },
        editable: !isLocked,
        required: isRequired,
        placeholder: isRequired ? `Enter ${name.replace(/[!*]/g, '').trim()}` : undefined,
    };
}

// ─── Stories: Text Content Resolver ──────────────────────────────────────────

type StoryMap = Map<string, { content: string; fontFamily: string; fontSize: number; color: string; fontWeight: number }>;

function parseStories(zip: JSZip): StoryMap {
    const map: StoryMap = new Map();

    // jszip .files is a plain object keyed by path
    for (const [path, file] of Object.entries(zip.files)) {
        if (!path.startsWith('Stories/') || !path.endsWith('.xml')) continue;

        // We'll process these async in the caller — store file refs here
        // (populated synchronously in parseIdmlSync after awaiting all text)
        void file;
    }

    return map;
}

async function buildStoryMap(zip: JSZip): Promise<StoryMap> {
    const map: StoryMap = new Map();

    for (const [path, file] of Object.entries(zip.files)) {
        if (!path.startsWith('Stories/') || !path.endsWith('.xml') || file.dir) continue;

        const text = await file.async('text');
        const doc = parseXml(text);
        const stories = childrenOf(doc, 'Story');

        for (const story of stories) {
            const storyId = attr(story, 'Self');
            if (!storyId) continue;

            // Collect all Content elements for raw text
            const contents = childrenOf(story, 'Content');
            const rawText = contents.map((c) => c.textContent ?? '').join('');

            // Get first character style for font info
            const csRanges = childrenOf(story, 'CharacterStyleRange');
            const firstCs = csRanges[0];
            const fontFamily = attr(firstCs ?? story, 'AppliedFont') || 'sans-serif';
            const fontSize = parseFloat(attr(firstCs ?? story, 'PointSize') || '16');
            const fillColorRef = attr(firstCs ?? story, 'FillColor');
            const color = resolveColorRef(fillColorRef) ?? '#000000';
            const fontStyle = (attr(firstCs ?? story, 'FontStyle') || '').toLowerCase();
            const fontWeight = fontStyle.includes('bold') ? 700 : 400;

            map.set(storyId, { content: rawText, fontFamily, fontSize, color, fontWeight });
        }
    }

    return map;
}

// ─── Styles: Brand Color + Font Extraction ────────────────────────────────────

type StyleData = { colors: BrandColor[]; fonts: BrandFont[] };

async function extractStyles(zip: JSZip): Promise<StyleData> {
    const stylesFile = zip.files['Resources/Styles.xml'];
    const colors: BrandColor[] = [];
    const fonts: BrandFont[] = [];
    const seenColors = new Set<string>();
    const seenFonts = new Set<string>();

    if (!stylesFile) return { colors, fonts };

    const text = await stylesFile.async('text');
    const doc = parseXml(text);

    // Paragraph styles → brand colors
    for (const style of childrenOf(doc, 'ParagraphStyle')) {
        const fillRef = attr(style, 'FillColor');
        const hex = fillRef ? resolveColorRef(fillRef) : null;
        const name = attr(style, 'Name');
        if (hex && !seenColors.has(hex) && hex !== '#ffffff' && hex !== '#000000') {
            seenColors.add(hex);
            colors.push({ id: uuidv4(), name: name || `Brand Color ${colors.length + 1}`, value: hex, locked: true });
        }
    }

    // Character styles → brand fonts
    for (const style of childrenOf(doc, 'CharacterStyle')) {
        const family = attr(style, 'AppliedFont');
        if (family && !seenFonts.has(family)) {
            seenFonts.add(family);
            fonts.push({ id: uuidv4(), family, variants: ['Regular'], url: '', locked: true });
        }
    }

    return { colors, fonts };
}

// ─── PageItem Builders ────────────────────────────────────────────────────────

function buildPageItem(
    el: Element,
    storyMap: StoryMap,
    zIndex: number,
): Layer | null {
    const tag = el.tagName;
    const self = attr(el, 'Self');
    const name = attr(el, 'Name') || attr(el, 'Label') || self;
    const visible = attr(el, 'Visible') !== 'false';
    const opacity = parseFloat(attr(el, 'Opacity') || '100') / 100;
    const bounds = attr(el, 'GeometricBounds');
    const itemTransform = attr(el, 'ItemTransform');

    if (!bounds) return null;

    const transform = buildTransformFromBounds(bounds, itemTransform);
    const constraints = buildConstraints(name, visible);
    const displayName = name.replace(/^[!]|[*]$/g, '').trim() || tag;

    let properties: LayerProperties;
    let type: Layer['type'];

    switch (tag) {
        case 'TextFrame': {
            type = 'text';
            const storyRef = attr(el, 'ParentStory');
            const story = storyMap.get(storyRef) ?? { content: '', fontFamily: 'sans-serif', fontSize: 16, color: '#000000', fontWeight: 400 };
            properties = {
                layerType: 'text',
                opacity,
                blendMode: 'normal',
                visible,
                zIndex,
                content: story.content,
                fontFamily: story.fontFamily,
                fontWeight: story.fontWeight,
                fontSize: story.fontSize,
                lineHeight: 1.2,
                letterSpacing: 0,
                color: story.color,
                align: 'left',
                verticalAlign: 'top',
                textTransform: 'none',
                truncate: false,
            };
            break;
        }

        case 'Rectangle':
        case 'Oval':
        case 'GraphicFrame': {
            // GraphicFrame may contain an image
            const hasImage = childrenOf(el, 'Image').length > 0 || childrenOf(el, 'PDF').length > 0;

            if (hasImage) {
                type = 'image';
                properties = {
                    layerType: 'image',
                    opacity,
                    blendMode: 'normal',
                    visible,
                    zIndex,
                    assetId: null,
                    src: null,
                    objectFit: 'cover',
                    objectPosition: 'center',
                };
            } else {
                type = 'shape';
                const fillRef = attr(el, 'FillColor');
                const strokeRef = attr(el, 'StrokeColor');
                properties = {
                    layerType: 'shape',
                    opacity,
                    blendMode: 'normal',
                    visible,
                    zIndex,
                    shapeType: tag === 'Oval' ? 'ellipse' : 'rect',
                    fill: resolveColorRef(fillRef) ?? '#e5e7eb',
                    stroke: resolveColorRef(strokeRef) ?? 'none',
                    strokeWidth: parseFloat(attr(el, 'StrokeWeight') || '0'),
                    cornerRadius: 0,
                };
            }
            break;
        }

        case 'Group': {
            type = 'group';
            properties = { layerType: 'group', opacity, blendMode: 'normal', visible, zIndex };
            const children: Layer[] = [];
            for (let i = 0; i < el.childNodes.length; i++) {
                const child = el.childNodes[i] as Element;
                if (child.nodeType !== 1) continue;
                const childLayer = buildPageItem(child, storyMap, i);
                if (childLayer) children.push(childLayer);
            }
            return { id: uuidv4(), name: displayName, type, transform, constraints, properties, children, sourceIndex: zIndex };
        }

        default:
            return null;
    }

    return { id: uuidv4(), name: displayName, type, transform, constraints, properties, sourceIndex: zIndex };
}

// ─── Document Dimensions ─────────────────────────────────────────────────────

async function getDocumentDimensions(zip: JSZip): Promise<{ width: number; height: number; spreadPaths: string[] }> {
    const designmapFile = zip.files['designmap.xml'];
    if (!designmapFile) return { width: 1080, height: 1080, spreadPaths: [] };

    const text = await designmapFile.async('text');
    const doc = parseXml(text);

    // Collect spread file paths
    const spreadPaths: string[] = [];
    const spreadNodes = doc.getElementsByTagName('idPkg:Spread');
    for (let i = 0; i < spreadNodes.length; i++) {
        spreadPaths.push(attr(spreadNodes[i] as Element, 'src'));
    }

    // Extract page dimensions from the document element
    const docEl = doc.getElementsByTagName('Document')[0] as Element | undefined;
    if (docEl) {
        const w = parseFloat(attr(docEl, 'DocumentPageWidth') || '0');
        const h = parseFloat(attr(docEl, 'DocumentPageHeight') || '0');
        if (w > 0 && h > 0) {
            return {
                width: Math.round(w * PT_TO_PX),
                height: Math.round(h * PT_TO_PX),
                spreadPaths,
            };
        }
    }

    return { width: 1080, height: 1080, spreadPaths };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function parseIdml(buffer: ArrayBuffer, fileName: string): Promise<SmartTemplate> {
    const zip = await JSZip.loadAsync(buffer);

    const [{ width, height, spreadPaths }, storyMap, styleData] = await Promise.all([
        getDocumentDimensions(zip),
        buildStoryMap(zip),
        extractStyles(zip),
    ]);

    const layers: Layer[] = [];
    let zIndex = 0;

    // Parse first spread (first page) — for multi-page support, iterate all spreadPaths
    const targetSpread = spreadPaths[0] ?? Object.keys(zip.files).find((p) => p.startsWith('Spreads/') && p.endsWith('.xml'));
    if (targetSpread) {
        const spreadFile = zip.files[targetSpread];
        if (spreadFile) {
            const spreadText = await spreadFile.async('text');
            const spreadDoc = parseXml(spreadText);

            // Collect all direct page items (TextFrame, Rectangle, Oval, GraphicFrame, Group)
            const itemTags = ['TextFrame', 'Rectangle', 'Oval', 'GraphicFrame', 'Group', 'Line'];
            for (const tag of itemTags) {
                const items = childrenOf(spreadDoc, tag);
                for (const item of items) {
                    const layer = buildPageItem(item, storyMap, zIndex++);
                    if (layer) layers.push(layer);
                }
            }
        }
    }

    const brand: BrandGuardrails = {
        colors: styleData.colors,
        fonts: styleData.fonts,
        logos: [],
    };

    return {
        id: uuidv4(),
        name: fileName.replace(/\.idml$/i, ''),
        description: '',
        version: '1.0.0',
        status: 'draft',
        dimensions: { width, height },
        platforms: ['instagram-post'],
        brand,
        layers,
        metadata: {
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            author: 'Imported',
            tags: [],
            sourceFormat: 'idml',
            originalFileName: fileName,
        },
    };
}
