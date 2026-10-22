import { Logo } from '@/components/Logo';

const EmptyDashboard = (props: {
  show: boolean;
  children: React.ReactNode;
}) => {
  const { show, children } = props;
  if (show) {
    return (
      <div
        className="d-flex align-center justify-center flex-column -mt-8"
        style={{ height: '100%' }}
      >
        <Logo size={48} />
        <div className="text-lg text-medium text-center gray-8 mt-3">
          No charts have been added yet
        </div>
        <div className="gray-7">
          Create a thread, generate a chart, then pin it to your dashboard.
        </div>
      </div>
    );
  }
  return <>{children}</>;
};

export default EmptyDashboard;
