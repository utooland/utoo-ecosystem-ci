import { defineConfig } from 'umi';

export default defineConfig({
  mfsu: false,
  routes: [{ path: '/', component: '@/pages/index' }],
  utoopack: {
    persistentCaching: false,
    devServer: { hot: process.env.ECOSYSTEM_HMR_ENABLED !== '0' },
    output: { chunkFilename: 'assets/[name].[contenthash:8].async.js' },
  },
});
