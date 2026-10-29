import { Typography, Tag } from 'antd';
import { makeIterable } from '@/utils/iteration';
import { Spinner } from '@/components/PageLoading';
import useKailoText from '@/utils/kailoI18n';

interface Props {
  tables: string[];
  loading?: boolean;
  isAdjustment?: boolean;
}

const TagTemplate = ({ name }: { name: string }) => {
  return <Tag className="mb-2">{name}</Tag>;
};

const TagIterator = makeIterable(TagTemplate);

export default function Retrieving(props: Props) {
  const { tables, loading, isAdjustment } = props;
  const t = useKailoText();

  const data = tables.map((table) => ({ name: table }));

  const title = isAdjustment
    ? t('home.stepModelsApplied')
    : t('home.stepRetrieving');

  const modelDescription = isAdjustment
    ? t('home.stepModelsAppliedCount', { count: tables.length })
    : t('home.stepCandidatesFound', { count: tables.length });

  return (
    <>
      <Typography.Text className="gray-8">{title}</Typography.Text>
      <div className="gray-7 text-sm mt-1">
        {loading ? (
          <div className="d-flex align-center gx-2">
            {t('home.stepSearching')}
            <Spinner className="gray-7" size={12} />
          </div>
        ) : (
          <>
            <div className="mb-1">{modelDescription}</div>
            <TagIterator data={data} />
          </>
        )}
      </div>
    </>
  );
}
