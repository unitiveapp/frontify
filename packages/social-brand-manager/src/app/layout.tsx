/* (c) Copyright Frontify Ltd., all rights reserved. */

import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
    title: 'Brand Template Editor — Frontify',
    description: 'Create on-brand social media posts with locked brand guardrails and one-click publishing.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en">
            <body className="h-screen overflow-hidden bg-gray-50">{children}</body>
        </html>
    );
}
