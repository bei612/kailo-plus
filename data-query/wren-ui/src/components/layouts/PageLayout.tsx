import { Typography } from 'antd';
import useKailoSession from '@/hooks/useKailoSession';

interface PageLayoutProps {
  title: string | React.ReactNode;
  description?: string | React.ReactNode;
  children: React.ReactNode;
  titleExtra?: string | React.ReactNode;
}

// DD-152 (20 §13 页面框架): inside Kailo the title and the page's main
// action are Kailo's page header (useKailoPage), so only the description
// and content render here; top-level visits keep the title row. List and
// table pages: 24 sides, 16 top.
export default function PageLayout(props: PageLayoutProps) {
  const { title, titleExtra, description, children } = props;
  const { hostPage } = useKailoSession();
  return (
    <div className="kailo-page">
      {!hostPage && (
        <div className="d-flex align-center justify-space-between mb-3">
          <Typography.Title level={2} className="kailo-page__title mb-0">
            {title}
          </Typography.Title>
          {titleExtra}
        </div>
      )}
      {description && (
        <Typography.Paragraph className="kailo-page__description">
          {description}
        </Typography.Paragraph>
      )}
      <div className="mt-3">{children}</div>
    </div>
  );
}
