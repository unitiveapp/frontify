/* (c) Copyright Unitiveapp, all rights reserved. */

/**
 * Sketch (.sketch) → SmartTemplate parser.
 *
 * Sketch files are ZIP archives:
 *   document.json      – document metadata, page refs
 *   pages/<id>.json    – per-page layer tree
 *   meta.json          – app version, fonts used
 *   images/            – embedded bitmap assets
 *
 * Layer class → SmartTemplate type:
 *   artboard / symbolMaster  → canvas dimensions (not a layer)
 *   text                     → 'text'
 *   rectangle                → 'shape' (rect)
 *   oval                     → 'shape' (ellipse)
 *   shapePath / shapeGroup   → 'shape' (path)
 *   image / bitmap           → 'image'
 *   group / symbolInstance   → 'group'
 *
 * Constraint conventions (same as all other parsers):
 *   !LayerName  – brand-locked (all LockFlags true)
 *   LayerName*  – required field
 *   isLocked: true in Sketch → also brand-locked
 *
 * Sketch coordinate system:
 *   - Artboard frame is in page coords (we ignore page offset)
 *   - Child layers have frames relative to their artboard
 *   - Rotation is counter-clockwise (we negate to match CSS/Fabric)
 *   - Colors are { red, green, blue, alpha } in 0–1 range
 */

import JSZip from 'jszip';
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

// ─── Sketch JSON Types ────────────────────────────────────────────────────────

type SketchColor = { red: number; green: number; blue: number; alpha: number };

type SketchFill = {
    _class: 'fill';
    isEnabled: boolean;
    fillType: number; // 0=solid, 1=gradient, 4=image
    color: SketchColor;
    image?: { _ref: string };
};

type SketchBorder = {
    _class: 'border';
    isEnabled: boolean;
    color: SketchColor;
    thickness: number;
};

type SketchStyle = {
    fills?: SketchFill[];
    borders?: SketchBorder[];
    contextSettings?: { opacity: number };
};

type SketchFrame = { x: number; y: number; width: number; height: number };

type SketchTextAttribute = {
    location: number;
    length: number;
    attributes: {
        MSAttributedStringFontAttribute?: { attributes: { name: string; size: number } };
        MSAttributedStringColorAttribute?: SketchColor;
        paragraphStyle?: { alignment?: number };
        underline?: number;
        strikethrough?: boolean;
    };
};

type SketchLayer = {
    _class: string;
    do_objectID: string;
    name: string;
    isVisible?: boolean;
    isLocked?: boolean;
    frame: SketchFrame;
    rotation?: number;
    style?: SketchStyle;
    layers?: SketchLayer[];
    // Text specific
    attributedString?: {
        string: string;
        attributes: SketchTextAttribute[];
    };
    // Image specific
    image?: { _ref: string };
    clippingMaskMode?: number;
};

type SketchPage = {
    _class: 'page';
    do_objectID: string;
    name: string;
    layers: SketchLayer[];
};

type SketchDocument = {
    pages: Array<{ _ref: string }>;
    fontReferences?: Array<{ fontFace: string; fontData?: unknown }>;
};

// ─── Colour Helpers ───────────────────────────────────────────────────────────

function sketchColorToHex(c: SketchColor): string {
    const r = Math.round(c.red * 255);
    const g = Math.round(c.green * 255);
    const b = Math.round(c.blue * 255);
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function solidFillColor(style: SketchStyle | undefined): string {
    const fill = style?.fills?.find((f) => f.isEnabled && f.fillType === 0);
    return fill ? sketchColorToHex(fill.color) : '#e5e7eb';
}

function borderColor(style: SketchStyle | undefined): string {
    const b = style?.borders?.find((b) => b.isEnabled);
    return b ? sketchColorToHex(b.color) : 'none';
}

function hasImageFill(style: SketchStyle | undefined): boolean {
    return !!style?.fills?.some((f) => f.isEnabled && f.fillType === 4);
}

// ─── Constraints ─────────────────────────────────────────────────────────────

const DEFAULT_LOCK: LockFlags = {
    position: false, size: false, rotation: false,
    opacity: false, color: false, font: false, content: false, hidden: false,
};
const FULL_LOCK: LockFlags = {
    position: true, size: true, rotation: true,
    opacity: true, color: true, font: true, content: true, hidden: false,
};

function buildConstraints(layer: SketchLayer): LayerConstraints {
    const name = layer.name;
    const nameLocked = name.startsWith('!');
    const sketchLocked = layer.isLocked === true;
    const isLocked = nameLocked || sketchLocked;
    const isRequired = name.endsWith('*');

    return {
        locked: isLocked ? FULL_LOCK : DEFAULT_LOCK,
        editable: !isLocked,
        required: isRequired,
        placeholder: isRequired ? `Enter ${name.replace(/[!*]/g, '').trim()}` : undefined,
    };
}

// ─── Transform ────────────────────────────────────────────────────────────────

function buildTransform(layer: SketchLayer): Transform {
    const { x, y, width, height } = layer.frame;
    // Sketch rotation is counter-clockwise; CSS/Fabric uses clockwise
    const rotation = layer.rotation ? -layer.rotation : 0;
    return {
        x: Math.round(x),
        y: Math.round(y),
        width: Math.max(Math.round(width), 1),
        height: Math.max(Math.round(height), 1),
        rotation: Math.round(rotation),
        scaleX: 1,
        scaleY: 1,
    };
}

// ─── Layer Builder ────────────────────────────────────────────────────────────

function buildLayer(layer: SketchLayer, zIndex: number): Layer | null {
    const cls = layer._class;
    const visible = layer.isVisible !== false;
    const opacity = layer.style?.contextSettings?.opacity ?? 1;
    const displayName = layer.name.replace(/^[!]|[*]$/g, '').trim() || cls;
    const transform = buildTransform(layer);
    const constraints = buildConstraints(layer);
    const common = { opacity, blendMode: 'normal' as const, visible, zIndex };

    switch (cls) {
        case 'text': {
            const str = layer.attributedString;
            const firstAttr = str?.attributes?.[0]?.attributes;
            const font = firstAttr?.MSAttributedStringFontAttribute?.attributes;
            const color = firstAttr?.MSAttributedStringColorAttribute;
            const alignment = firstAttr?.paragraphStyle?.alignment ?? 0;
            const alignMap: Record<number, 'left' | 'right' | 'center' | 'justify'> = {
                0: 'left', 1: 'right', 2: 'center', 3: 'justify',
            };

            return {
                id: uuidv4(),
                name: displayName,
                type: 'text',
                transform,
                constraints,
                properties: {
                    layerType: 'text',
                    ...common,
                    content: str?.string ?? '',
                    fontFamily: font?.name ?? 'sans-serif',
                    fontWeight: 400,
                    fontSize: font?.size ?? 16,
                    lineHeight: 1.2,
                    letterSpacing: 0,
                    color: color ? sketchColorToHex(color) : '#000000',
                    align: alignMap[alignment] ?? 'left',
                    verticalAlign: 'top',
                    textTransform: 'none',
                    truncate: false,
                },
                sourceIndex: zIndex,
            };
        }

        case 'rectangle': {
            if (hasImageFill(layer.style)) {
                return {
                    id: uuidv4(), name: displayName, type: 'image', transform, constraints,
                    properties: { layerType: 'image', ...common, assetId: null, src: null, objectFit: 'cover', objectPosition: 'center' },
                    sourceIndex: zIndex,
                };
            }
            return {
                id: uuidv4(), name: displayName, type: 'shape', transform, constraints,
                properties: {
                    layerType: 'shape', ...common,
                    shapeType: 'rect',
                    fill: solidFillColor(layer.style),
                    stroke: borderColor(layer.style),
                    strokeWidth: layer.style?.borders?.find((b) => b.isEnabled)?.thickness ?? 0,
                    cornerRadius: 0,
                },
                sourceIndex: zIndex,
            };
        }

        case 'oval':
            return {
                id: uuidv4(), name: displayName, type: 'shape', transform, constraints,
                properties: {
                    layerType: 'shape', ...common,
                    shapeType: 'ellipse',
                    fill: solidFillColor(layer.style),
                    stroke: borderColor(layer.style),
                    strokeWidth: layer.style?.borders?.find((b) => b.isEnabled)?.thickness ?? 0,
                },
                sourceIndex: zIndex,
            };

        case 'shapePath':
        case 'shapeGroup':
            return {
                id: uuidv4(), name: displayName, type: 'shape', transform, constraints,
                properties: {
                    layerType: 'shape', ...common,
                    shapeType: 'path',
                    fill: solidFillColor(layer.style),
                    stroke: borderColor(layer.style),
                    strokeWidth: layer.style?.borders?.find((b) => b.isEnabled)?.thickness ?? 0,
                },
                sourceIndex: zIndex,
            };

        case 'image':
        case 'bitmap':
            return {
                id: uuidv4(), name: displayName, type: 'image', transform, constraints,
                properties: { layerType: 'image', ...common, assetId: null, src: null, objectFit: 'cover', objectPosition: 'center' },
                sourceIndex: zIndex,
            };

        case 'group':
        case 'symbolInstance': {
            const children = (layer.layers ?? [])
                .map((child, i) => buildLayer(child, i))
                .filter((l): l is Layer => l !== null);
            return {
                id: uuidv4(), name: displayName, type: 'group', transform, constraints,
                properties: { layerType: 'group', ...common },
                children,
                sourceIndex: zIndex,
            };
        }

        default:
            return null;
    }
}

// ─── Brand Extraction ─────────────────────────────────────────────────────────

function extractBrandColors(layers: SketchLayer[]): BrandColor[] {
    const seen = new Set<string>();
    const colors: BrandColor[] = [];

    const walk = (ls: SketchLayer[]) => {
        for (const l of ls) {
            const fill = l.style?.fills?.find((f) => f.isEnabled && f.fillType === 0);
            if (fill) {
                const hex = sketchColorToHex(fill.color);
                if (!seen.has(hex) && hex !== '#ffffff' && hex !== '#000000') {
                    seen.add(hex);
                    colors.push({ id: uuidv4(), name: `Brand Color ${colors.length + 1}`, value: hex, locked: true });
                }
            }
            if (l.attributedString?.attributes) {
                for (const attr of l.attributedString.attributes) {
                    const c = attr.attributes.MSAttributedStringColorAttribute;
                    if (c) {
                        const hex = sketchColorToHex(c);
                        if (!seen.has(hex) && hex !== '#ffffff' && hex !== '#000000') {
                            seen.add(hex);
                            colors.push({ id: uuidv4(), name: `Brand Color ${colors.length + 1}`, value: hex, locked: true });
                        }
                    }
                }
            }
            if (l.layers) walk(l.layers);
        }
    };

    walk(layers);
    return colors.slice(0, 20);
}

function extractBrandFonts(layers: SketchLayer[]): BrandFont[] {
    const seen = new Set<string>();
    const fonts: BrandFont[] = [];

    const walk = (ls: SketchLayer[]) => {
        for (const l of ls) {
            if (l._class === 'text' && l.attributedString?.attributes) {
                for (const attr of l.attributedString.attributes) {
                    const name = attr.attributes.MSAttributedStringFontAttribute?.attributes.name;
                    if (name && !seen.has(name)) {
                        seen.add(name);
                        fonts.push({ id: uuidv4(), family: name, variants: ['Regular'], url: '', locked: true });
                    }
                }
            }
            if (l.layers) walk(l.layers);
        }
    };

    walk(layers);
    return fonts;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function parseSketch(buffer: ArrayBuffer, fileName: string): Promise<SmartTemplate> {
    const zip = await JSZip.loadAsync(buffer);

    // Read document.json to get page refs
    const docFile = zip.files['document.json'];
    if (!docFile) throw new Error('Invalid .sketch file: missing document.json');

    const doc: SketchDocument = JSON.parse(await docFile.async('text'));
    const pageRef = doc.pages[0]?._ref;
    if (!pageRef) throw new Error('No pages found in Sketch file');

    // Load first page
    const pageFile = zip.files[`${pageRef}.json`] ?? zip.files[`${pageRef}`];
    if (!pageFile) throw new Error(`Could not read Sketch page: ${pageRef}`);

    const page: SketchPage = JSON.parse(await pageFile.async('text'));

    // Find first artboard (or symbolMaster) as canvas
    const artboard = page.layers.find(
        (l) => l._class === 'artboard' || l._class === 'symbolMaster',
    );

    if (!artboard) throw new Error('No artboard found on Sketch page. Add an artboard to your design first.');

    const width = Math.round(artboard.frame.width);
    const height = Math.round(artboard.frame.height);
    const artboardLayers = artboard.layers ?? [];

    // Build layer tree (bottom → top = index 0 → n)
    const layers: Layer[] = artboardLayers
        .map((l, i) => buildLayer(l, i))
        .filter((l): l is Layer => l !== null);

    const brand: BrandGuardrails = {
        colors: extractBrandColors(artboardLayers),
        fonts: extractBrandFonts(artboardLayers),
        logos: [],
    };

    return {
        id: uuidv4(),
        name: artboard.name || fileName.replace(/\.sketch$/i, ''),
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
            sourceFormat: 'sketch',
            originalFileName: fileName,
        },
    };
}
