import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  defaultSidebar: [
    'intro',
    {
      type: 'category',
      label: '快速开始',
      collapsed: false,
      items: ['getting-started/quickstart', 'getting-started/pages-setup'],
    },
    {
      type: 'category',
      label: '架构与安全',
      items: ['architecture/overview', 'architecture/security'],
    },
    {
      type: 'category',
      label: '功能指南',
      items: ['guides/schema-explorer', 'guides/query-execution'],
    },
  ],
};

export default sidebars;
