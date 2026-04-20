/* (c) Copyright Frontify Ltd., all rights reserved. */

import { DOMParser } from 'xmldom';
import { v4 as uuidv4 } from 'uuid';
import type {
    BrandColor,
    BrandGuardrails,
    Layer,
    LayerConstraints,
    LayerProperties,
    LockFlags,
    SmartTemplate,
    Transform,
} from '../types/SmartTemplate';

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function parseTransform(element: Element, parentWidth: number, parentHeight: number): Transform {
    const x = parseFloat(element.getAttribute('x') ?? element.getAttribute('cx') ?? '0');
    const y = parseFloat(element.getAttribute('y') ?? element.getAttribute('cy') ?? '0');
    const width = parseFloat(element.getAttribute('width') ?? element.getAttribute('rx') ?? '100');
    const height = parseFloat(element.getAttribute('height') ?? element.getAttribute('ry') ?? '100');

    return {
        x: isNaN(x) ? 0 : x,
        y: isNaN(y) ? 0 : y,
        width: isNaN(width) || width <= 0 ? parentWidth : width,
        height: isNaN(height) || height <= 0 ? parentHeight : height,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
    };
}

function buildDefaultConstraints(id: string): LayerConstraints {
    const isLocked = id.startsWith('locked-') || id.startsWith('brand-');
    return {
        locked: isLocked ? Object.fromEntries(Object.keys(DEFAULT_LOCK_FLAGS).map((k) => [k, true])) as LockFlags : DEFAULT_LOCK_FLAGS,
        editable: !isLocked,
        required: id.endsWith('-required'),
    };
}

function extractFill(element: Element): string {
    return element.getAttribute('fill') ?? element.getAttribute('style')?.match(/fill:\s*([^;]+)/)?.[1]?.trim() ?? '#000000';
}

// ─── Element → Layer ──────────────────────────────────────────────────────────

function svgElementToLayer(element: Element, width: number, height: number, index: number): Layer | null {
    const tag = element.tagName.toLowerCase();
    const id = element.getAttribute('id') ?? uuidv4();
    const label = element.getAttribute('inkscape:label') ?? element.getAttribute('aria-label') ?? id;

    const transform = parseTransform(element, width, height);
    const constraints = buildDefaultConstraints(id);

    let properties: LayerProperties;

    switch (tag) {
        case 'text':
        case 'tspan': {
            properties = {
                layerType: 'text',
                opacity: parseFloat(element.getAttribute('opacity') ?? '1'),
                blendMode: 'normal',
                visible: element.getAttribute('display') !== 'none',
                zIndex: index,
                content: element.textContent ?? '',
                fontFamily: element.getAttribute('font-family') ?? 'sans-serif',
                fontWeight: parseInt(element.getAttribute('font-weight') ?? '400', 10),
                fontSize: parseFloat(element.getAttribute('font-size') ?? '16'),
                lineHeight: 1.2,
                letterSpacing: parseFloat(element.getAttribute('letter-spacing') ?? '0'),
                color: extractFill(element),
                align: (element.getAttribute('text-anchor') === 'middle' ? 'center' : 'left'),
                verticalAlign: 'top',
                textTransform: 'none',
                truncate: false,
            };
            break;
        }

        case 'image': {
            properties = {
                layerType: 'image',
                opacity: parseFloat(element.getAttribute('opacity') ?? '1'),
                blendMode: 'normal',
                visible: true,
                zIndex: index,
                assetId: null,
                src: element.getAttribute('href') ?? element.getAttribute('xlink:href') ?? null,
                objectFit: 'cover',
                objectPosition: 'center',
            };
            break;
        }

        case 'rect':
        case 'circle':
        case 'ellipse':
        case 'polygon':
        case 'path': {
            const shapeTypeMap: Record<string, 'rect' | 'ellipse' | 'polygon' | 'path'> = {
                rect: 'rect',
                circle: 'ellipse',
                ellipse: 'ellipse',
                polygon: 'polygon',
                path: 'path',
            };
            properties = {
                layerType: 'shape',
                opacity: parseFloat(element.getAttribute('opacity') ?? '1'),
                blendMode: 'normal',
                visible: true,
                zIndex: index,
                shapeType: shapeTypeMap[tag] ?? 'rect',
                fill: extractFill(element),
                stroke: element.getAttribute('stroke') ?? 'none',
                strokeWidth: parseFloat(element.getAttribute('stroke-width') ?? '0'),
                cornerRadius: parseFloat(element.getAttribute('rx') ?? '0'),
                pathData: element.getAttribute('d') ?? undefined,
            };
            break;
        }

        case 'g': {
            // Group element — recurse into children
            const children: Layer[] = [];
            for (let i = 0; i < element.childNodes.length; i++) {
                const child = element.childNodes[i] as Element;
                if (child.nodeType !== 1) continue;
                const childLayer = svgElementToLayer(child, width, height, i);
                if (childLayer) children.push(childLayer);
            }

            properties = {
                layerType: 'group',
                opacity: parseFloat(element.getAttribute('opacity') ?? '1'),
                blendMode: 'normal',
                visible: true,
                zIndex: index,
            };

            return {
                id: uuidv4(),
                name: label,
                type: 'group',
                transform,
                constraints,
                properties,
                children,
                sourceIndex: index,
            };
        }

        default:
            return null;
    }

    return {
        id: uuidv4(),
        name: label,
        type: (properties as { layerType: string }).layerType as Layer['type'],
        transform,
        constraints,
        properties,
        sourceIndex: index,
    };
}

// ─── Brand Color Extraction ───────────────────────────────────────────────────

function extractBrandColors(doc: Document): BrandColor[] {
    const fills = new Set<string>();
    const all = doc.getElementsByTagName('*');
    for (let i = 0; i < all.length; i++) {
        const el = all[i] as Element;
        const fill = el.getAttribute('fill');
        if (fill && fill !== 'none' && fill.startsWith('#')) {
            fills.add(fill.toLowerCase());
        }
    }
    return Array.from(fills).map((hex, i) => ({
        id: uuidv4(),
        name: `Brand Color ${i + 1}`,
        value: hex,
        locked: true,
    }));
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function parseSvg(svgString: string, fileName: string): SmartTemplate {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgString, 'image/svg+xml');
    const svgEl = doc.documentElement;

    const width = parseFloat(svgEl.getAttribute('width') ?? '1080') || 1080;
    const height = parseFloat(svgEl.getAttribute('height') ?? '1080') || 1080;

    const layers: Layer[] = [];
    for (let i = 0; i < svgEl.childNodes.length; i++) {
        const node = svgEl.childNodes[i] as Element;
        if (node.nodeType !== 1) continue;
        const layer = svgElementToLayer(node, width, height, i);
        if (layer) layers.push(layer);
    }

    const brand: BrandGuardrails = {
        colors: extractBrandColors(doc),
        fonts: [],
        logos: [],
    };

    return {
        id: uuidv4(),
        name: fileName.replace(/\.svg$/i, ''),
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
            sourceFormat: 'svg',
            originalFileName: fileName,
        },
    };
}
