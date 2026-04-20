/* (c) Copyright Frontify Ltd., all rights reserved. */

// ─── Social Platform Targets ──────────────────────────────────────────────────

export type SocialPlatform =
    | 'instagram-post'
    | 'instagram-story'
    | 'instagram-reel'
    | 'facebook-post'
    | 'facebook-story'
    | 'twitter-post'
    | 'linkedin-post'
    | 'tiktok-cover'
    | 'youtube-thumbnail'
    | 'pinterest-pin';

export const PLATFORM_DIMENSIONS: Record<SocialPlatform, { width: number; height: number }> = {
    'instagram-post': { width: 1080, height: 1080 },
    'instagram-story': { width: 1080, height: 1920 },
    'instagram-reel': { width: 1080, height: 1920 },
    'facebook-post': { width: 1200, height: 630 },
    'facebook-story': { width: 1080, height: 1920 },
    'twitter-post': { width: 1600, height: 900 },
    'linkedin-post': { width: 1200, height: 627 },
    'tiktok-cover': { width: 1080, height: 1920 },
    'youtube-thumbnail': { width: 1280, height: 720 },
    'pinterest-pin': { width: 1000, height: 1500 },
};

// ─── Layer Permission Model ────────────────────────────────────────────────────

export type LockFlags = {
    /** Prevents moving the layer */
    position: boolean;
    /** Prevents resizing */
    size: boolean;
    /** Prevents rotation */
    rotation: boolean;
    /** Prevents opacity changes */
    opacity: boolean;
    /** Prevents fill/stroke color changes */
    color: boolean;
    /** Prevents font-family/weight/size changes */
    font: boolean;
    /** Prevents text content or image swap */
    content: boolean;
    /** Hides layer entirely from non-designer editors */
    hidden: boolean;
};

export type ValidationRule =
    | { type: 'minLength'; value: number; message: string }
    | { type: 'maxLength'; value: number; message: string }
    | { type: 'regex'; pattern: string; message: string }
    | { type: 'required'; message: string }
    | { type: 'aspectRatio'; ratio: string; message: string }
    | { type: 'fileType'; allowed: string[]; message: string };

export type LayerConstraints = {
    /** Lock map — each flag blocks a specific edit dimension */
    locked: LockFlags;
    /** Whether non-designers may interact with this layer at all */
    editable: boolean;
    /** User must fill this layer before publishing */
    required: boolean;
    /** Hint shown in the editor when the field is empty */
    placeholder?: string;
    /** Runtime validation rules */
    validation?: ValidationRule[];
    /** If set, restricts color choices to named brand palette */
    allowedColorPaletteIds?: string[];
    /** If set, restricts asset picks to these Frontify project IDs */
    allowedProjectIds?: number[];
};

// ─── Layer Types ──────────────────────────────────────────────────────────────

export type LayerType = 'text' | 'image' | 'shape' | 'group' | 'video' | 'background';

export type BlendMode =
    | 'normal'
    | 'multiply'
    | 'screen'
    | 'overlay'
    | 'darken'
    | 'lighten'
    | 'color-dodge'
    | 'color-burn'
    | 'hard-light'
    | 'soft-light'
    | 'difference'
    | 'exclusion';

export type Transform = {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    scaleX: number;
    scaleY: number;
};

export type TextProperties = {
    content: string;
    fontFamily: string;
    fontWeight: number;
    fontSize: number;
    lineHeight: number;
    letterSpacing: number;
    color: string;
    align: 'left' | 'center' | 'right' | 'justify';
    verticalAlign: 'top' | 'middle' | 'bottom';
    textTransform: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
    truncate: boolean;
};

export type ImageProperties = {
    /** Frontify asset ID — null means placeholder */
    assetId: number | null;
    src: string | null;
    objectFit: 'cover' | 'contain' | 'fill' | 'none';
    objectPosition: string;
};

export type ShapeProperties = {
    shapeType: 'rect' | 'ellipse' | 'polygon' | 'path';
    fill: string;
    stroke: string;
    strokeWidth: number;
    cornerRadius?: number;
    pathData?: string;
};

export type LayerProperties = {
    opacity: number;
    blendMode: BlendMode;
    visible: boolean;
    zIndex: number;
} & (
    | ({ layerType: 'text' } & TextProperties)
    | ({ layerType: 'image' } & ImageProperties)
    | ({ layerType: 'shape' } & ShapeProperties)
    | ({ layerType: 'background' } & ImageProperties)
    | { layerType: 'group' | 'video' }
);

export type Layer = {
    id: string;
    name: string;
    /** Mirrors LayerProperties.layerType for easy discrimination */
    type: LayerType;
    transform: Transform;
    constraints: LayerConstraints;
    properties: LayerProperties;
    /** Nested layers — only populated when type === 'group' */
    children?: Layer[];
    /** Original layer index from source file (PSD/IDML) */
    sourceIndex?: number;
};

// ─── Brand Guardrails ─────────────────────────────────────────────────────────

export type BrandColor = {
    id: string;
    name: string;
    /** Hex value e.g. "#FF0000" */
    value: string;
    /** If true, only designers can delete this from the palette */
    locked: boolean;
};

export type BrandFont = {
    id: string;
    family: string;
    variants: string[];
    /** URL to woff2 file for browser rendering */
    url: string;
    locked: boolean;
};

export type BrandLogo = {
    id: string;
    name: string;
    /** Frontify asset ID */
    assetId: number;
    previewUrl: string;
    /** Designers mark logos as locked — non-designers may not swap them */
    locked: boolean;
};

export type BrandGuardrails = {
    colors: BrandColor[];
    fonts: BrandFont[];
    logos: BrandLogo[];
};

// ─── Smart Template (root schema) ────────────────────────────────────────────

export type SmartTemplateStatus = 'draft' | 'review' | 'approved' | 'archived';

export type SmartTemplate = {
    /** UUID */
    id: string;
    name: string;
    description: string;
    /** Semver string e.g. "1.0.0" */
    version: string;
    status: SmartTemplateStatus;
    dimensions: {
        width: number;
        height: number;
    };
    /** Supported social platforms this template is sized for */
    platforms: SocialPlatform[];
    /** Brand guardrails — enforced globally across all layers */
    brand: BrandGuardrails;
    /** Ordered array of layers (bottom → top, same as PSD) */
    layers: Layer[];
    /** Thumbnail data URI or CDN URL for template preview */
    thumbnailUrl?: string;
    metadata: {
        createdAt: string;
        updatedAt: string;
        /** Frontify user display name */
        author: string;
        /** Frontify project the template belongs to */
        projectId?: number;
        tags: string[];
        /** Source file format that was imported */
        sourceFormat: 'psd' | 'idml' | 'svg' | 'manual';
        originalFileName?: string;
    };
};

// ─── Editor Session State ─────────────────────────────────────────────────────

export type EditorLayerOverride = {
    layerId: string;
    /** Only override the editable properties — brand-locked flags are ignored */
    textContent?: string;
    assetId?: number;
    assetSrc?: string;
    color?: string;
};

export type EditorSession = {
    templateId: string;
    /** Snapshot of the template as loaded — used for reset */
    baseTemplate: SmartTemplate;
    /** User overrides applied on top of the base template */
    overrides: EditorLayerOverride[];
    targetPlatform: SocialPlatform;
    isDirty: boolean;
    lastSavedAt?: string;
};

// ─── Publish Output ───────────────────────────────────────────────────────────

export type RenderFormat = 'png' | 'jpeg' | 'webp' | 'mp4';

export type RenderJob = {
    id: string;
    templateId: string;
    overrides: EditorLayerOverride[];
    format: RenderFormat;
    quality: number;
    /** Requested output dimensions (defaults to template dimensions) */
    outputWidth?: number;
    outputHeight?: number;
    status: 'queued' | 'processing' | 'done' | 'error';
    resultUrl?: string;
    errorMessage?: string;
    createdAt: string;
    completedAt?: string;
};

// ─── API Shapes ───────────────────────────────────────────────────────────────

export type TemplateUploadResponse = {
    template: SmartTemplate;
    warnings: string[];
};

export type RenderRequest = {
    template: SmartTemplate;
    overrides: EditorLayerOverride[];
    format: RenderFormat;
    quality?: number;
};

export type RenderResponse = {
    jobId: string;
    /** base64-encoded image data for synchronous renders */
    data?: string;
    mimeType?: string;
    width: number;
    height: number;
};
