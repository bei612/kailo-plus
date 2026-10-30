import SimpleLayout from '@/components/layouts/SimpleLayout';
import PageLayout from '@/components/layouts/PageLayout';
import DataSourceList, {
  useDataSourceList,
} from '@/components/pages/dataSources/DataSourceList';
import { useCurrentDataSource } from '@/components/pages/dataSources/DataSourcePicker';
import useKailoPage from '@/hooks/useKailoPage';
import useKailoText from '@/utils/kailoI18n';

// DD-169(4)②(6)②: the business "数据源" page for every member — which data
// sources this instance has (names, types, status and model counts; never
// connection settings) and which one this tab works on. No create, edit,
// delete or shortcut to the admin area (`07` §4.8.5 obligation 3): data
// sources are maintained on the Kailo admin surface.
export default function DataSources() {
  const t = useKailoText();
  const list = useDataSourceList();
  const { currentId, switchTo } = useCurrentDataSource();

  useKailoPage({
    title: t('dataSources.title'),
    ready: !list.loading || !!list.data,
  });

  return (
    <SimpleLayout loading={false}>
      <PageLayout
        title={t('dataSources.title')}
        description={t('dataSources.description')}
      >
        <DataSourceList
          list={list}
          currentId={currentId}
          onSetCurrent={(row) => switchTo(row.id)}
        />
      </PageLayout>
    </SimpleLayout>
  );
}
