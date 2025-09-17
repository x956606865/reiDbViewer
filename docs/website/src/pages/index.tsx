import Layout from '@theme/Layout';
import Link from '@docusaurus/Link';
import Heading from '@theme/Heading';
import styles from './index.module.css';

const features = [
  {
    title: '只读安全第一',
    description:
      '所有查询通过 withSafeSession 执行，自动设置超时与 search_path，Saved SQL 仅允许 SELECT/WITH。',
    href: '/docs/architecture/security',
  },
  {
    title: '模板语法升级',
    description:
      '在现有 {{name}} 语法上扩展条件与循环（规划中），支持动态裁剪 SQL 片段并保持参数化。',
    href: '/docs/guides/query-execution',
  },
  {
    title: 'GitHub Pages 自动部署',
    description:
      '基于 Docusaurus 与 GitHub Actions，推送到 main 分支即可生成并发布文档站点。',
    href: '/docs/getting-started/pages-setup',
  },
];

export default function Home(): JSX.Element {
  return (
    <Layout
      title="reiDbView 文档"
      description="Read-first PostgreSQL 浏览器的官方文档站">
      <header className={styles.heroBanner}>
        <div className="container">
          <Heading as="h1" className={styles.heroTitle}>
            reiDbView 文档站
          </Heading>
          <p className={styles.heroSubtitle}>
            聚焦只读安全、模板语法与 GitHub Pages 部署的完整指南。
          </p>
          <div className={styles.buttons}>
            <Link className="button button--primary" to="/docs/intro">
              开始阅读
            </Link>
            <Link className="button button--secondary" to="https://github.com/<your-org>/reiDbView">
              GitHub 仓库
            </Link>
          </div>
        </div>
      </header>
      <main>
        <section className={styles.featureSection}>
          <div className="container">
            <div className="row">
              {features.map(feature => (
                <div key={feature.title} className="col col--4">
                  <div className={styles.featureCard}>
                    <Heading as="h3">{feature.title}</Heading>
                    <p>{feature.description}</p>
                    <Link to={feature.href}>了解更多 →</Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
    </Layout>
  );
}
