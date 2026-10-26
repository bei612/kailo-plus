import BaseTable, {
  Props,
  COLUMN,
  ExpandableRows,
} from '@/components/table/BaseTable';
import { kailoT } from '@/utils/kailoI18n';

export default function RelationTable(props: Props) {
  const { columns, showExpandable } = props;
  return (
    <BaseTable
      {...props}
      columns={
        columns || [
          { ...COLUMN.NAME, dataIndex: 'displayName' },
          COLUMN.RELATION_FROM,
          COLUMN.RELATION_TO,
          COLUMN.RELATION,
          { ...COLUMN.DESCRIPTION, width: 160 },
        ]
      }
      expandable={
        showExpandable
          ? {
              expandedRowRender: (record) => (
                <ExpandableRows
                  data={[
                    {
                      title: kailoT('modeling.from'),
                      value: `${record.fromModelDisplayName}.${record.fromColumnDisplayName}`,
                    },
                    {
                      title: kailoT('modeling.to'),
                      value: `${record.toModelDisplayName}.${record.toColumnDisplayName}`,
                    },
                    {
                      title: kailoT('modeling.description'),
                      value: record.description || '-',
                    },
                  ]}
                />
              ),
            }
          : null
      }
    />
  );
}
