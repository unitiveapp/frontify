/* (c) Copyright Unitiveapp, all rights reserved. */

import { readPsd, type Layer as PsdLayer, type Psd } from 'ag-psd';
import { v4 as uuidv4 } from 'uuid';
import type {
    BrandColor,
    BrandGuardrails,
    Layer,
    LayerConstraints,
    LayerProperties,
    LockFlags,
    SmartTemplate,
    TextProperties,
    Transform,
} from '../types/SmartTemplate';

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_LOCK_FLAGS: LockFlags = {
    position: false,
    size: false,
    rotation: false,
    opacity: false,
    color: false,
    font: false,
    content: false,
    hidden: false,
};

const DESIGNER_LOCK_FLAGS: LockFlags = {
    position: true,
    size: true,
    rotation: true,
    opacity: true,
    color: true,
    font: true,
    content: true,
    hidden: false,
};

// ─── Colour Helpers ───────────────────────────────────────────────────────────

function rgbToHex(r: number, g: number, b: number): string {
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function extractColorFromPsdColor(color: { r: number; g: number; b: number } | undefined): string {
    if (!color) return '#000000';
    return rgbToHex(color.r, color.g, color.b);
}

// ─── Transform ────────────────────────────────────────────────────────────────

function buildTransform(layer: PsdLayer, psdWidth: number, psdHeight: number): Transform {
    const left = layer.left ?? 0;
    const top = layer.top ?? 0;
    const right = layer.right ?? psdWidth;
    const bottom = layer.bottom ?? psdHeight;

    return {
        x: left,
        y: top,
        width: Math.max(right - left, 1),
        height: Math.max(bottom - top, 1),
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
    };
}

// ─── Layer Constraints ────────────────────────────────────────────────────────

/**
 * PSD layers whose names begin with "!" are treated as brand-locked by convention.
 * Layers with names ending with "*" are marked as required.
 */
function buildConstraints(layer: PsdLayer): LayerConstraints {
    const name = layer.name ?? '';
    const isDesignerLocked = name.startsWith('!');
    const isRequired = name.endsWith('*');

    return {
        locked: isDesignerLocked ? DESIGNER_LOCK_FLAGS : DEFAULT_LOCK_FLAGS,
        editable: !isDesignerLocked,
        required: isRequired,
        placeholder: isRequired ? `Enter ${name.replace(/[!*]/g, '').trim()}` : undefined,
    };
}

// ─── Text Layer ───────────────────────────────────────────────────────────────

function buildTextProperties(layer: PsdLayer): TextProperties {
    const td = layer.text;
    const style = td?.style ?? {};
    const paragraphStyle = td?.paragraphStyle ?? {};

    return {
        content: td?.text ?? '',
        fontFamily: (style.font?.name as string | undefined) ?? 'sans-serif',
        fontWeight: (style.font?.syntheticBold ? 700 : 400),
        fontSize: (style.fontSize as number | undefined) ?? 16,
        lineHeight: 1.2,
        letterSpacing: (style.tracking as number | undefined) ?? 0,
        color: extractColorFromPsdColor(style.fillColor as { r: number; g: number; b: number } | undefined),
        align: ((paragraphStyle.justification as string | undefined)?.toLowerCase() as TextProperties['align']) ?? 'left',
        verticalAlign: 'top',
        textTransform: 'none',
        truncate: false,
    };
}

// ─── Layer Builder ────────────────────────────────────────────────────────────

function buildLayer(psdLayer: PsdLayer, psdWidth: number, psdHeight: number, index: number): Layer {
    const name = psdLayer.name ?? `Layer ${index}`;
    const transform = buildTransform(psdLayer, psdWidth, psdHeight);
    const constraints = buildConstraints(psdLayer);
    const isGroup = !!(psdLayer.children && psdLayer.children.length > 0);
    const isText = !!psdLayer.text;

    let type: Layer['type'] = 'image';
    let properties: LayerProperties;

    if (isGroup) {
        type = 'group';
        properties = {
            layerType: 'group',
            opacity: (psdLayer.opacity ?? 255) / 255,
            blendMode: 'normal',
            visible: !psdLayer.hidden,
            zIndex: index,
        };
    } else if (isText) {
        type = 'text';
        const textProps = buildTextProperties(psdLayer);
        properties = {
            layerType: 'text',
            opacity: (psdLayer.opacity ?? 255) / 255,
            blendMode: 'normal',
            visible: !psdLayer.hidden,
            zIndex: index,
            ...textProps,
        };
    } else {
        type = 'image';
        properties = {
            layerType: 'image',
            opacity: (psdLayer.opacity ?? 255) / 255,
            blendMode: 'normal',
            visible: !psdLayer.hidden,
            zIndex: index,
            assetId: null,
            src: null,
            objectFit: 'cover',
            objectPosition: 'center',
        };
    }

    const layer: Layer = {
        id: uuidv4(),
        name: name.replace(/^[!]|[*]$/g, '').trim(),
        type,
        transform,
        constraints,
        properties,
        sourceIndex: index,
    };

    if (isGroup && psdLayer.children) {
        layer.children = psdLayer.children
            .map((child, i) => buildLayer(child, psdWidth, psdHeight, i))
            .reverse(); // PSD layers are bottom-to-top
    }

    return layer;
}

// ─── Brand Color Extraction ───────────────────────────────────────────────────

function extractBrandColors(psd: Psd): BrandColor[] {
    const colors: BrandColor[] = [];
    const seen = new Set<string>();

    const walk = (layers: PsdLayer[]) => {
        for (const layer of layers) {
            if (layer.text?.style?.fillColor) {
                const c = layer.text.style.fillColor as { r: number; g: number; b: number };
                const hex = rgbToHex(c.r, c.g, c.b);
                if (!seen.has(hex)) {
                    seen.add(hex);
                    colors.push({ id: uuidv4(), name: `Color ${colors.length + 1}`, value: hex, locked: true });
                }
            }
            if (layer.children) walk(layer.children);
        }
    };

    if (psd.children) walk(psd.children);
    return colors;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse a PSD ArrayBuffer and return a SmartTemplate JSON.
 * This runs server-side via the /api/templates upload route.
 */
export function parsePsd(buffer: ArrayBuffer, fileName: string): SmartTemplate {
    const psd: Psd = readPsd(buffer);

    const width = psd.width ?? 1080;
    const height = psd.height ?? 1080;

    const layers: Layer[] = (psd.children ?? [])
        .map((child, i) => buildLayer(child, width, height, i))
        .reverse();

    const brandColors: BrandColor[] = extractBrandColors(psd);

    const brand: BrandGuardrails = {
        colors: brandColors,
        fonts: [],
        logos: [],
    };

    return {
        id: uuidv4(),
        name: fileName.replace(/\.psd$/i, ''),
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
            sourceFormat: 'psd',
            originalFileName: fileName,
        },
    };
}
