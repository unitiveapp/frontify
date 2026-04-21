/* (c) Copyright Unitiveapp, all rights reserved. */

import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
    title: 'Uniplate',
    description: 'Design-to-publish brand template engine — import PSD, IDML, SVG or Figma, enforce brand guardrails, publish to social.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en">
            <body className="h-screen overflow-hidden bg-gray-50">{children}</body>
        </html>
    );
}
