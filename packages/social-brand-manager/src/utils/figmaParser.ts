/* (c) Copyright Frontify Ltd., all rights reserved. */

/**
 * Figma REST API → SmartTemplate parser.
 *
 * Figma node tree:  DOCUMENT → PAGE → FRAME → [TEXT, RECTANGLE, ELLIPSE,
 *                              IMAGE, GROUP, COMPONENT, INSTANCE, VECTOR…]
 *
 * REST API endpoint:  GET https://api.figma.com/v1/files/:key
 * Headers:            X-Figma-Token: <personalAccessToken>
 *
 * Constraint conventions (applied via Figma layer names — same as PSD):
 *   !LayerName  → brand-locked
 *   LayerName*  → required
 *
 * Figma color values are { r, g, b, a } in the 0–1 range.
 * Transforms use the Figma absoluteBoundingBox / relativeTransform system.
 *
 * Only the first PAGE of the Figma file is imported. To import all pages,
 * call parseFigmaPage() for each entry in document.children.
 */

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

// ─── Figma API Types ──────────────────────────────────────────────────────────

type FigmaColor = { r: number; g: number; b: number; a: number };

type FigmaPaint =
    | { type: 'SOLID'; color: FigmaColor; opacity?: number; visible?: boolean }
    | { type: 'IMAGE'; imageRef?: string; scaleMode?: string; visible?: boolean }
    | { type: string; visible?: boolean };

type FigmaTypeStyle = {
    fontFamily?: string;
    fontPostScriptName?: string;
    fontWeight?: number;
    fontSize?: number;
    textAlignHorizontal?: 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED';
    letterSpacing?: number;
    lineHeightPx?: number;
    italic?: boolean;
};

type FigmaTransform = [[number, number, number], [number, number, number]];

type FigmaRect = { x: number; y: number; width: number; height: number };

type FigmaNode = {
    id: string;
    name: string;
    type: string;
    visible?: boolean;
    opacity?: number;
    children?: FigmaNode[];
    absoluteBoundingBox?: FigmaRect;
    relativeTransform?: FigmaTransform;
    fills?: FigmaPaint[];
    strokes?: FigmaPaint[];
    strokeWeight?: number;
    cornerRadius?: number;
    characters?: string;
    style?: FigmaTypeStyle;
    /** Figma COMPONENT_SET children */
    componentPropertyDefinitions?: Record<string, unknown>;
    effects?: unknown[];
};

type FigmaFile = {
    name: string;
    document: FigmaNode;
    version?: string;
};

// ─── Colour Helpers ───────────────────────────────────────────────────────────

function figmaColorToHex(c: FigmaColor): string {
    const r = Math.round(c.r * 255);
    const g = Math.round(c.g * 255);
    const b = Math.round(c.b * 255);
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function extractFill(fills: FigmaPaint[] | undefined): string {
    if (!fills) return '#000000';
    const solid = fills.find((f): f is Extract<FigmaPaint, { type: 'SOLID' }> => f.type === 'SOLID' && (f.visible !== false));
    return solid ? figmaColorToHex(solid.color) : '#000000';
}

function hasImageFill(fills: FigmaPaint[] | undefined): boolean {
    return !!fills?.some((f) => f.type === 'IMAGE' && f.visible !== false);
}

// ─── Transform ────────────────────────────────────────────────────────────────

function buildTransform(node: FigmaNode, pageOffset: FigmaRect): Transform {
    const box = node.absoluteBoundingBox ?? { x: 0, y: 0, width: 100, height: 100 };

    // absoluteBoundingBox is in file-level coordinates — subtract page origin
    const x = Math.round(box.x - pageOffset.x);
    const y = Math.round(box.y - pageOffset.y);
    const width = Math.round(box.width);
    const height = Math.round(box.height);

    // Extract rotation from relativeTransform matrix [ [a, b, tx], [c, d, ty] ]
    const m = node.relativeTransform;
    const rotation = m ? Math.round(Math.atan2(m[0][1], m[0][0]) * (180 / Math.PI)) : 0;

    return { x, y, width: Math.max(width, 1), height: Math.max(height, 1), rotation, scaleX: 1, scaleY: 1 };
}

// ─── Constraints ─────────────────────────────────────────────────────────────

const DEFAULT_LOCK: LockFlags = { position: false, size: false, rotation: false, opacity: false, color: false, font: false, content: false, hidden: false };
const FULL_LOCK: LockFlags = { position: true, size: true, rotation: true, opacity: true, color: true, font: true, content: true, hidden: false };

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

// ─── Node → Layer ─────────────────────────────────────────────────────────────

function figmaNodeToLayer(
    node: FigmaNode,
    pageOffset: FigmaRect,
    zIndex: number,
): Layer | null {
    const visible = node.visible !== false;
    const opacity = node.opacity ?? 1;
    const transform = buildTransform(node, pageOffset);
    const constraints = buildConstraints(node.name, visible);
    const displayName = node.name.replace(/^[!]|[*]$/g, '').trim();

    const commonProps = { opacity, blendMode: 'normal' as const, visible, zIndex };

    switch (node.type) {
        case 'TEXT': {
            const style = node.style ?? {};
            const fills = node.fills;
            const align = style.textAlignHorizontal?.toLowerCase() as 'left' | 'center' | 'right' | 'justify' | undefined;
            return {
                id: uuidv4(),
                name: displayName,
                type: 'text',
                transform,
                constraints,
                properties: {
                    layerType: 'text',
                    ...commonProps,
                    content: node.characters ?? '',
                    fontFamily: style.fontFamily ?? 'sans-serif',
                    fontWeight: style.fontWeight ?? 400,
                    fontSize: style.fontSize ?? 16,
                    lineHeight: style.lineHeightPx ? style.lineHeightPx / (style.fontSize ?? 16) : 1.2,
                    letterSpacing: style.letterSpacing ?? 0,
                    color: extractFill(fills),
                    align: (align === 'justified' ? 'justify' : align) ?? 'left',
                    verticalAlign: 'top',
                    textTransform: 'none',
                    truncate: false,
                },
                sourceIndex: zIndex,
            };
        }

        case 'RECTANGLE':
        case 'ELLIPSE':
        case 'VECTOR':
        case 'BOOLEAN_OPERATION':
        case 'LINE':
        case 'POLYGON':
        case 'STAR': {
            if (hasImageFill(node.fills)) {
                return {
                    id: uuidv4(),
                    name: displayName,
                    type: 'image',
                    transform,
                    constraints,
                    properties: { layerType: 'image', ...commonProps, assetId: null, src: null, objectFit: 'cover', objectPosition: 'center' },
                    sourceIndex: zIndex,
                };
            }
            return {
                id: uuidv4(),
                name: displayName,
                type: 'shape',
                transform,
                constraints,
                properties: {
                    layerType: 'shape',
                    ...commonProps,
                    shapeType: node.type === 'ELLIPSE' ? 'ellipse' : 'rect',
                    fill: extractFill(node.fills),
                    stroke: extractFill(node.strokes),
                    strokeWidth: node.strokeWeight ?? 0,
                    cornerRadius: node.cornerRadius ?? 0,
                },
                sourceIndex: zIndex,
            };
        }

        case 'FRAME':
        case 'GROUP':
        case 'COMPONENT':
        case 'INSTANCE':
        case 'COMPONENT_SET': {
            // A FRAME with only an image fill and no children → background image layer
            if (node.type === 'FRAME' && hasImageFill(node.fills) && (!node.children || node.children.length === 0)) {
                return {
                    id: uuidv4(),
                    name: displayName,
                    type: 'background',
                    transform,
                    constraints,
                    properties: { layerType: 'background', ...commonProps, assetId: null, src: null, objectFit: 'cover', objectPosition: 'center' },
                    sourceIndex: zIndex,
                };
            }

            const children: Layer[] = (node.children ?? [])
                .map((child, i) => figmaNodeToLayer(child, pageOffset, i))
                .filter((l): l is Layer => l !== null);

            return {
                id: uuidv4(),
                name: displayName,
                type: 'group',
                transform,
                constraints,
                properties: { layerType: 'group', ...commonProps },
                children,
                sourceIndex: zIndex,
            };
        }

        default:
            return null;
    }
}

// ─── Brand Extraction ─────────────────────────────────────────────────────────

function collectBrandColors(nodes: FigmaNode[]): BrandColor[] {
    const seen = new Set<string>();
    const colors: BrandColor[] = [];

    const walk = (n: FigmaNode) => {
        for (const paint of [...(n.fills ?? []), ...(n.strokes ?? [])]) {
            if (paint.type === 'SOLID' && paint.visible !== false) {
                const hex = figmaColorToHex((paint as Extract<FigmaPaint, { type: 'SOLID' }>).color);
                if (!seen.has(hex) && hex !== '#ffffff' && hex !== '#000000') {
                    seen.add(hex);
                    colors.push({ id: uuidv4(), name: `Brand Color ${colors.length + 1}`, value: hex, locked: true });
                }
            }
        }
        (n.children ?? []).forEach(walk);
    };

    nodes.forEach(walk);
    return colors.slice(0, 20); // cap at 20 brand colors
}

function collectBrandFonts(nodes: FigmaNode[]): BrandFont[] {
    const seen = new Set<string>();
    const fonts: BrandFont[] = [];

    const walk = (n: FigmaNode) => {
        if (n.type === 'TEXT' && n.style?.fontFamily) {
            const family = n.style.fontFamily;
            if (!seen.has(family)) {
                seen.add(family);
                fonts.push({ id: uuidv4(), family, variants: ['Regular'], url: '', locked: true });
            }
        }
        (n.children ?? []).forEach(walk);
    };

    nodes.forEach(walk);
    return fonts;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Fetch a Figma file and convert its first page to a SmartTemplate. */
export async function parseFigmaFile(
    fileKey: string,
    accessToken: string,
    pageIndex = 0,
): Promise<SmartTemplate> {
    const res = await fetch(`https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}`, {
        headers: { 'X-Figma-Token': accessToken },
    });

    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Figma API error ${res.status}: ${body}`);
    }

    const file: FigmaFile = await res.json();
    return parseFigmaDocument(file, pageIndex);
}

/** Parse a pre-fetched Figma file JSON (useful when using the Figma MCP server). */
export function parseFigmaDocument(file: FigmaFile, pageIndex = 0): SmartTemplate {
    const pages = file.document.children?.filter((n) => n.type === 'PAGE') ?? [];
    const page = pages[pageIndex] ?? pages[0];

    if (!page) {
        throw new Error('Figma file has no pages');
    }

    // Use first top-level FRAME as the template canvas
    const topFrames = (page.children ?? []).filter((n) => n.type === 'FRAME' || n.type === 'COMPONENT');
    const canvas = topFrames[0];

    if (!canvas?.absoluteBoundingBox) {
        throw new Error('No top-level FRAME found on the Figma page');
    }

    const pageOffset = canvas.absoluteBoundingBox;
    const width = Math.round(pageOffset.width);
    const height = Math.round(pageOffset.height);

    // Build layers from canvas children
    const layers: Layer[] = (canvas.children ?? [])
        .map((child, i) => figmaNodeToLayer(child, pageOffset, i))
        .filter((l): l is Layer => l !== null);

    const brand: BrandGuardrails = {
        colors: collectBrandColors(canvas.children ?? []),
        fonts: collectBrandFonts(canvas.children ?? []),
        logos: [],
    };

    return {
        id: uuidv4(),
        name: `${file.name}${pages.length > 1 ? ` — ${page.name}` : ''}`,
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
            author: 'Imported from Figma',
            tags: ['figma'],
            sourceFormat: 'figma',
            originalFileName: `${fileKey}.figma`,
        },
    };
}

// ─── URL Helpers ──────────────────────────────────────────────────────────────

/** Extract the file key from a Figma URL.
 *  e.g. https://www.figma.com/design/ABC123/My-File?node-id=... → "ABC123"
 */
export function extractFigmaFileKey(url: string): string | null {
    const m = url.match(/figma\.com\/(?:design|file|proto)\/([a-zA-Z0-9_-]+)/);
    return m?.[1] ?? null;
}
