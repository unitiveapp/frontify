/* (c) Copyright Unitiveapp, all rights reserved. */

/**
 * Frontify Template Bridge
 *
 * Bridges Frontify's native Template system (from @frontify/app-bridge) with our
 * SmartTemplate layer-permission schema.
 *
 * ─── The Two Systems ──────────────────────────────────────────────────────────
 *
 * Frontify native Template:
 *   { id: number, name, description, projectId, previewUrl, creationFormUri, pages[] }
 *   — Stores WHAT exists (metadata, preview image, multi-page structure)
 *   — Managed by Frontify's backend, accessed via AppBridge
 *
 * Our SmartTemplate:
 *   { id: string, layers[], brand: BrandGuardrails, dimensions, ... }
 *   — Stores HOW it works (layer tree, lock flags, brand constraints)
 *   — Lives in this app's state / block settings
 *
 * ─── Integration Strategy ─────────────────────────────────────────────────────
 *
 * 1. When a designer selects a Frontify template via the template chooser:
 *    frontifyTemplateToSmartTemplate() wraps each TemplatePage in an image layer
 *    pointing to its previewUrl. The designer can then add proper layers on top.
 *
 * 2. When a SmartTemplate is saved back:
 *    smartTemplateToFrontifyPayload() returns the metadata needed to create/update
 *    a Frontify template record (name, description, dimensions).
 *
 * 3. The SmartTemplate JSON is stored separately — typically in AppBridge block
 *    settings keyed by the Frontify template ID:
 *      appBridge.setBlockSettings({ [`smart-template-${id}`]: JSON.stringify(smartTemplate) })
 *
 * ─── Template Section Architecture ────────────────────────────────────────────
 *
 * Frontify Template Section (from research):
 *
 *  AppBridgeBlock methods:
 *    getBlockTemplates()                              → Record<settingId, Template[]>
 *    addTemplateIdsToBlockTemplateKey(key, ids)       → attach templates to a block
 *    deleteTemplateIdsFromBlockTemplateKey(key, ids)  → remove
 *    getTemplateById(id)                              → TemplateLegacy (deprecated)
 *
 *  AppBridgeTheme methods (3 contexts: cover / documentPage / library):
 *    getCoverPageTemplateSettings()                   → TSettings
 *    updateCoverPageTemplateSettings(settings)        → save to backend
 *    getCoverPageTemplateAssets()                     → Record<key, Asset[]>
 *    addAssetIdsToCoverPageTemplateAssetKey(key, ids) → link DAM assets
 *    ... (similar for documentPage and library)
 *
 *  React hooks wrapping the above:
 *    useBlockTemplates(appBridge)      → { blockTemplates, addTemplateIdsToKey, deleteTemplateIdsFromKey }
 *    useTemplateChooser(appBridge)     → { openTemplateChooser, closeTemplateChooser }
 *    useTemplateAssets(appBridge, type, docId?, pageId?)
 *    usePageTemplateSettings(appBridge, type, docOrPageId?)
 *    useTemplateContext(appBridge)     → { templateId, type, document?, documentPage?, coverPage? }
 *
 *  Events emitted:
 *    'AppBridge:BlockTemplatesUpdated'     → { blockId, blockTemplates, prevBlockTemplates }
 *    'AppBridge:TemplateAssetsUpdated'     → { template, documentId?, documentPageId?, templateAssets, prevTemplateAssets }
 *    'AppBridge:PageTemplateSettingsUpdated' → { pageTemplateSettings }
 *
 *  Template types:
 *    ThemeTemplate = 'documentPage' | 'cover' | 'library'
 *    Template      = { id, name, description, projectId, previewUrl, creationFormUri, pages: TemplatePage[] }
 *    TemplateLegacy = { id, title, description, previewUrl, projectId, height, width, published }
 *    DocumentBlockTemplate = { id, creator, created, modifier, modified, documentBlockId, settingId, template }
 *    PageTemplateAsset = { id, creator, created, settingId, assetId, asset }
 *
 *  Key insight: Frontify templates are REFERENCES (id → metadata + preview) stored on their
 *  backend. Our SmartTemplate adds the CONSTRAINT LAYER on top of those references.
 *  The two live in parallel and are linked by the Frontify template ID.
 */

import { v4 as uuidv4 } from 'uuid';
import type { Template, TemplateLegacy } from '../types/FrontifyTypes';
import type {
    BrandGuardrails,
    Layer,
    SmartTemplate,
    SocialPlatform,
} from '../types/SmartTemplate';

// ─── SmartTemplate Storage Key ────────────────────────────────────────────────

/** Block-settings key under which we store a SmartTemplate JSON, keyed by Frontify template ID. */
export const smartTemplateSettingKey = (frontifyTemplateId: number | string) =>
    `smart-template-${frontifyTemplateId}` as const;

/** Key under which ALL SmartTemplates for a block are stored as a JSON array. */
export const SMART_TEMPLATES_BLOCK_KEY = 'smart-templates' as const;

// ─── frontifyTemplate → SmartTemplate ────────────────────────────────────────

/**
 * Wrap a Frontify Template record in a SmartTemplate.
 *
 * Each TemplatePage becomes a background image layer (showing the page preview).
 * Because Frontify templates don't expose layer data, editors can:
 *  - Use the page previews as a guide underlay
 *  - Add editable text/image layers on top
 *  - Replace preview layers with real content once layers are defined
 */
export function frontifyTemplateToSmartTemplate(template: Template, platforms: SocialPlatform[] = ['instagram-post']): SmartTemplate {
    const firstPage = template.pages[0];
    const width = firstPage?.width ?? 1080;
    const height = firstPage?.height ?? 1080;

    const layers: Layer[] = template.pages.map((page, i) => ({
        id: uuidv4(),
        name: `!Page ${i + 1} Preview`,
        type: 'background' as const,
        transform: { x: 0, y: 0, width, height, rotation: 0, scaleX: 1, scaleY: 1 },
        constraints: {
            locked: {
                position: true, size: true, rotation: true,
                opacity: true, color: true, font: true, content: true, hidden: false,
            },
            editable: false,
            required: false,
            placeholder: undefined,
        },
        properties: {
            layerType: 'background' as const,
            opacity: 1,
            blendMode: 'normal' as const,
            visible: i === 0,
            zIndex: i,
            assetId: null,
            src: page.previewUrl,
            objectFit: 'contain' as const,
            objectPosition: 'center',
        },
        sourceIndex: i,
    }));

    const brand: BrandGuardrails = { colors: [], fonts: [], logos: [] };

    return {
        id: `frontify-${template.id}`,
        name: template.name,
        description: template.description ?? '',
        version: '1.0.0',
        status: 'draft',
        dimensions: { width, height },
        platforms,
        brand,
        layers,
        thumbnailUrl: template.previewUrl,
        metadata: {
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            author: 'Frontify',
            projectId: template.projectId,
            tags: [],
            sourceFormat: 'manual',
        },
    };
}

/**
 * Convert a legacy (deprecated) Frontify template to SmartTemplate.
 * The legacy type is single-page and has a flat structure.
 */
export function frontifyLegacyTemplateToSmartTemplate(template: TemplateLegacy): SmartTemplate {
    const layer: Layer = {
        id: uuidv4(),
        name: '!Template Preview',
        type: 'background',
        transform: { x: 0, y: 0, width: template.width, height: template.height, rotation: 0, scaleX: 1, scaleY: 1 },
        constraints: {
            locked: { position: true, size: true, rotation: true, opacity: true, color: true, font: true, content: true, hidden: false },
            editable: false,
            required: false,
        },
        properties: {
            layerType: 'background',
            opacity: 1,
            blendMode: 'normal',
            visible: true,
            zIndex: 0,
            assetId: null,
            src: template.previewUrl,
            objectFit: 'contain',
            objectPosition: 'center',
        },
        sourceIndex: 0,
    };

    return {
        id: `frontify-legacy-${template.id}`,
        name: template.title,
        description: template.description ?? '',
        version: '1.0.0',
        status: 'draft',
        dimensions: { width: template.width, height: template.height },
        platforms: ['instagram-post'],
        brand: { colors: [], fonts: [], logos: [] },
        layers: [layer],
        thumbnailUrl: template.previewUrl,
        metadata: {
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            author: 'Frontify',
            projectId: template.projectId,
            tags: [],
            sourceFormat: 'manual',
        },
    };
}

// ─── SmartTemplate → Frontify Payload ────────────────────────────────────────

/** Payload for creating/patching a Frontify template record from our SmartTemplate. */
export type FrontifyTemplateCreatePayload = {
    name: string;
    description: string;
    width: number;
    height: number;
    projectId?: number;
};

export function smartTemplateToFrontifyPayload(template: SmartTemplate): FrontifyTemplateCreatePayload {
    return {
        name: template.name,
        description: template.description,
        width: template.dimensions.width,
        height: template.dimensions.height,
        projectId: template.metadata.projectId,
    };
}

// ─── Block Settings Serialization ────────────────────────────────────────────

/**
 * Serialize a SmartTemplate to be stored inside AppBridge block settings.
 *
 * Usage:
 *   const patch = serializeSmartTemplate(smartTemplate);
 *   await appBridge.updateBlockSettings(patch);
 */
export function serializeSmartTemplate(template: SmartTemplate): Record<string, string> {
    return {
        [smartTemplateSettingKey(template.id)]: JSON.stringify(template),
    };
}

/**
 * Deserialize a SmartTemplate from AppBridge block settings.
 *
 * Usage:
 *   const settings = await appBridge.getBlockSettings();
 *   const template = deserializeSmartTemplate(templateId, settings);
 */
export function deserializeSmartTemplate(
    templateId: string | number,
    settings: Record<string, unknown>,
): SmartTemplate | null {
    const key = smartTemplateSettingKey(templateId);
    const raw = settings[key];
    if (typeof raw !== 'string') return null;
    try {
        return JSON.parse(raw) as SmartTemplate;
    } catch {
        return null;
    }
}

// ─── Multi-Template Registry ──────────────────────────────────────────────────

/**
 * Store a registry of SmartTemplate summaries (id + name + thumbnail) in block settings.
 * Full JSON is stored per-template under smartTemplateSettingKey().
 */
export type SmartTemplateSummary = {
    id: string;
    frontifyTemplateId?: number;
    name: string;
    thumbnailUrl?: string;
    dimensions: { width: number; height: number };
    platforms: SocialPlatform[];
    status: SmartTemplate['status'];
};

export function toSummary(template: SmartTemplate): SmartTemplateSummary {
    return {
        id: template.id,
        frontifyTemplateId: typeof template.id === 'string' && template.id.startsWith('frontify-')
            ? parseInt(template.id.replace(/^frontify(-legacy)?-/, ''), 10)
            : undefined,
        name: template.name,
        thumbnailUrl: template.thumbnailUrl,
        dimensions: template.dimensions,
        platforms: template.platforms,
        status: template.status,
    };
}

export function serializeRegistry(summaries: SmartTemplateSummary[]): Record<string, string> {
    return { [SMART_TEMPLATES_BLOCK_KEY]: JSON.stringify(summaries) };
}

export function deserializeRegistry(settings: Record<string, unknown>): SmartTemplateSummary[] {
    const raw = settings[SMART_TEMPLATES_BLOCK_KEY];
    if (typeof raw !== 'string') return [];
    try {
        return JSON.parse(raw) as SmartTemplateSummary[];
    } catch {
        return [];
    }
}
