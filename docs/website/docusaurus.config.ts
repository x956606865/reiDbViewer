import type { Config } from '@docusaurus/types';
import type { Preset } from '@docusaurus/preset-classic';

const config: Config = {
  title: 'reiDbView Docs',
  tagline: 'Read-first PostgreSQL browser',
  favicon: 'img/favicon.svg',
  url: 'https://x956606865.github.io', // TODO: replace with the actual production URL (e.g. https://username.github.io)
  baseUrl: '/reiDbViewer/',
  organizationName: 'x956606865',
  projectName: 'reiDbView',
  deploymentBranch: 'gh-pages',
  trailingSlash: false,
  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',
  future: {
    experimental_faster: {
      rspackBundler: false,
    },
  },
  i18n: {
    defaultLocale: 'zh-Hans',
    locales: ['zh-Hans'],
  },
  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl:
            'https://github.com/x956606865/reiDbView/tree/main/docs/website/',
          showLastUpdateAuthor: true,
          showLastUpdateTime: true,
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],
  themeConfig: {
    image: 'img/logo.svg',
    navbar: {
      title: 'reiDbView',
      logo: {
        alt: 'reiDbView logo',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'defaultSidebar',
          position: 'left',
          label: '文档',
        },
        {
          href: 'https://github.com/x956606865/reiDbView',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      copyright: `Copyright © ${new Date().getFullYear()} reiDbView contributors.`,
    },
    prism: {
      additionalLanguages: ['sql'],
    },
  },
};

export default config;
