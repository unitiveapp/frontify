/* (c) Copyright Frontify Ltd., all rights reserved. */

/**
 * useFrontifyTemplates
 *
 * Wraps @frontify/app-bridge's useBlockTemplates + useTemplateChooser to expose
 * SmartTemplates — marrying Frontify's native Template metadata with our
 * layer-permission schema.
 *
 * HOW IT WORKS:
 *   1. On mount, reads block templates from AppBridge (Frontify metadata).
 *   2. For each Frontify template, looks up a matching SmartTemplate in block settings
 *      (stored as JSON under `smart-template-<id>`).
 *   3. If no SmartTemplate exists yet, creates a scaffold from the Frontify preview.
 *   4. exposes:
 *      - smartTemplates: SmartTemplateSummary[]   — all available templates
 *      - openChooser()                            — opens Frontify's native chooser
 *      - saveSmartTemplate(t: SmartTemplate)      — persists to block settings
 *      - deleteSmartTemplate(id)                  — removes from block settings
 *
 * PREREQUISITE: Render this hook inside a Frontify Platform App (AppBridgeBlock context).
 * For standalone use (Next.js dev mode), pass appBridge = null to get a mock.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AppBridgeBlock, TemplateLegacy } from '../types/FrontifyTypes';
import { openTemplateChooser } from '../types/FrontifyTypes';
import {
    frontifyTemplateToSmartTemplate,
    frontifyLegacyTemplateToSmartTemplate,
    deserializeSmartTemplate,
    serializeSmartTemplate,
    deserializeRegistry,
    serializeRegistry,
    toSummary,
    type SmartTemplateSummary,
} from '../utils/frontifyBridge';
import type { SmartTemplate } from '../types/SmartTemplate';

// ─── Types ────────────────────────────────────────────────────────────────────

type UseFrontifyTemplatesOptions = {
    /** Pass the AppBridgeBlock instance from the host Frontify app. Null in standalone dev mode. */
    appBridge: AppBridgeBlock | null;
    /** Block-settings key used to group templates (default: 'social-brand-templates'). */
    settingKey?: string;
};

type UseFrontifyTemplatesReturn = {
    summaries: SmartTemplateSummary[];
    isLoading: boolean;
    error: string | null;
    /** Opens Frontify's native template chooser; auto-imports the chosen template. */
    openChooser: () => void;
    /** Persist a SmartTemplate to block settings. */
    saveSmartTemplate: (template: SmartTemplate) => Promise<void>;
    /** Remove a SmartTemplate from block settings. */
    deleteSmartTemplate: (id: string) => Promise<void>;
    /** Load the full SmartTemplate JSON for a given summary id. */
    loadSmartTemplate: (id: string) => SmartTemplate | null;
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useFrontifyTemplates({
    appBridge,
    settingKey = 'social-brand-templates',
}: UseFrontifyTemplatesOptions): UseFrontifyTemplatesReturn {
    const [summaries, setSummaries] = useState<SmartTemplateSummary[]>([]);
    const [rawSettings, setRawSettings] = useState<Record<string, unknown>>({});
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // ── Bootstrap: load block settings + derive summaries ──
    useEffect(() => {
        if (!appBridge) return;

        setIsLoading(true);
        (async () => {
            try {
                const settings = (await appBridge.getBlockSettings()) as Record<string, unknown>;
                setRawSettings(settings);

                const existingSummaries = deserializeRegistry(settings);
                if (existingSummaries.length > 0) {
                    setSummaries(existingSummaries);
                } else {
                    // First load — import all Frontify templates attached to this block
                    const blockTemplates = await appBridge.getBlockTemplates();
                    const allTemplates = Object.values(blockTemplates).flat();
                    const imported = allTemplates.map((t) => {
                        // Check if we already have a SmartTemplate stored for this
                        const existing = deserializeSmartTemplate(t.id, settings);
                        if (existing) return toSummary(existing);
                        // Scaffold from Frontify metadata
                        const smart = frontifyTemplateToSmartTemplate(t);
                        return toSummary(smart);
                    });
                    setSummaries(imported);
                }
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to load templates');
            } finally {
                setIsLoading(false);
            }
        })();
    }, [appBridge]);

    // ── Subscribe to block template updates ──
    useEffect(() => {
        if (!appBridge) return;

        const unsubscribe = (window as Window & { emitter?: { on: (event: string, cb: () => void) => void; off: (event: string, cb: () => void) => void } }).emitter?.on?.(
            'AppBridge:BlockTemplatesUpdated',
            () => {
                // Re-read settings when templates change
                appBridge.getBlockTemplates().then((blockTemplates) => {
                    const allTemplates = Object.values(blockTemplates).flat();
                    setSummaries((prev) => {
                        const prevIds = new Set(prev.map((s) => s.frontifyTemplateId));
                        const newSummaries = allTemplates
                            .filter((t) => !prevIds.has(t.id))
                            .map((t) => toSummary(frontifyTemplateToSmartTemplate(t)));
                        return [...prev, ...newSummaries];
                    });
                }).catch(() => { /* ignore */ });
            },
        );

        return () => {
            void unsubscribe;
        };
    }, [appBridge]);

    // ── Open Frontify template chooser ──
    const openChooser = useCallback(() => {
        if (!appBridge) return;

        appBridge.dispatch(openTemplateChooser());

        const unsubscribe = appBridge.subscribe('templateChosen', async (event) => {
            unsubscribe();
            const chosenLegacy = (event as { template: TemplateLegacy }).template;
            if (!chosenLegacy) return;

            const smart = frontifyLegacyTemplateToSmartTemplate(chosenLegacy);
            await saveSmartTemplate(smart);
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [appBridge]);

    // ── Save SmartTemplate to block settings ──
    const saveSmartTemplate = useCallback(
        async (template: SmartTemplate) => {
            if (!appBridge) {
                // Standalone dev mode — keep in component state only
                setSummaries((prev) => {
                    const existing = prev.findIndex((s) => s.id === template.id);
                    const summary = toSummary(template);
                    return existing >= 0
                        ? prev.map((s, i) => (i === existing ? summary : s))
                        : [...prev, summary];
                });
                return;
            }

            const newSummaries = summaries.some((s) => s.id === template.id)
                ? summaries.map((s) => (s.id === template.id ? toSummary(template) : s))
                : [...summaries, toSummary(template)];

            const patch = {
                ...serializeSmartTemplate(template),
                ...serializeRegistry(newSummaries),
            };

            await appBridge.updateBlockSettings(patch);
            setSummaries(newSummaries);
            setRawSettings((prev) => ({ ...prev, ...patch }));
        },
        [appBridge, summaries],
    );

    // ── Delete SmartTemplate from block settings ──
    const deleteSmartTemplate = useCallback(
        async (id: string) => {
            const updated = summaries.filter((s) => s.id !== id);

            if (appBridge) {
                const patch = serializeRegistry(updated);
                // We don't delete the raw JSON key to avoid accidental data loss;
                // it simply won't appear in the registry anymore.
                await appBridge.updateBlockSettings(patch);
            }

            setSummaries(updated);
        },
        [appBridge, summaries],
    );

    // ── Load full SmartTemplate JSON ──
    const loadSmartTemplate = useCallback(
        (id: string): SmartTemplate | null => {
            return deserializeSmartTemplate(id, rawSettings);
        },
        [rawSettings],
    );

    return {
        summaries,
        isLoading,
        error,
        openChooser,
        saveSmartTemplate,
        deleteSmartTemplate,
        loadSmartTemplate,
    };
}
