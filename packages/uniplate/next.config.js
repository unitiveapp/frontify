/** @type {import('next').NextConfig} */
const nextConfig = {
    output: 'standalone',
    experimental: {
        serverComponentsExternalPackages: ['sharp', 'ag-psd'],
    },
    webpack: (config, { isServer }) => {
        if (!isServer) {
            // fabric.js requires canvas on server — exclude from client bundle
            config.externals = [...(config.externals || [])];
        }
        return config;
    },
};

module.exports = nextConfig;
