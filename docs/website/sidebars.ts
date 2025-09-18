import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  defaultSidebar: [
    'intro',
    {
      type: 'category',
      label: '欢迎与快速入门',
      collapsed: false,
      items: ['welcome/welcome-getting-started'],
    },
    {
      type: 'category',
      label: '界面与导航',
      items: ['ui/ui-overview'],
    },
    {
      type: 'category',
      label: '核心功能指南',
      items: [
        'connections/connections-management',
        'dashboard/dashboard-home',
        'schema/schema-explorer-guide',
        'data/data-browser',
        'saved-sql/saved-sql-guide',
        'ops/ops-toolkit',
        'settings/settings-preferences',
      ],
    },
    {
      type: 'category',
      label: '任务导向',
      items: ['tasks/task-playbooks'],
    },
    {
      type: 'category',
      label: '安全与合规',
      items: ['security/security-compliance'],
    },
    {
      type: 'category',
      label: '版本与附录',
      items: ['releases/releases-notes', 'appendix/appendix-resources'],
    },
  ],
};

export default sidebars;
