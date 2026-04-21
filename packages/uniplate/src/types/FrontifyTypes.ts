/* (c) Copyright Unitiveapp, all rights reserved. */

/**
 * Minimal type stubs for the Frontify AppBridge integration.
 *
 * These replace the workspace dependency on @frontify/app-bridge so the
 * social-brand-manager package stands alone without the SDK monorepo.
 * Only the members we actually call are declared.
 */

// ─── Template Types ───────────────────────────────────────────────────────────

export type TemplatePage = {
    previewUrl: string;
    width: number;
    height: number;
};

export type Template = {
    id: number;
    name: string;
    description: string;
    projectId: number;
    previewUrl: string;
    creationFormUri: string;
    pages: TemplatePage[];
};

export type TemplateLegacy = {
    id: number;
    title: string;
    description: string | null;
    previewUrl: string;
    projectId: number;
    height: number;
    width: number;
    published: boolean;
};

// ─── AppBridge Minimal Interface ──────────────────────────────────────────────

type DispatchCommand = { name: string };
type UnsubscribeFn = () => void;

export interface AppBridgeBlock {
    dispatch(command: DispatchCommand): void;
    subscribe(event: string, callback: (event: unknown) => void): UnsubscribeFn;
    getBlockSettings<T = Record<string, unknown>>(): Promise<T>;
    updateBlockSettings<T = Record<string, unknown>>(newSettings: T): Promise<void>;
    getBlockTemplates(): Promise<Record<string, Template[]>>;
}

// ─── Command Helpers ──────────────────────────────────────────────────────────

export const openTemplateChooser = (): DispatchCommand => ({ name: 'openTemplateChooser' });
