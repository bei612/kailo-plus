import BaseTable, {
  Props,
  COLUMN,
  ExpandableRows,
} from '@/components/table/BaseTable';
import { kailoT } from '@/utils/kailoI18n';

export default function CalculatedFieldTable(props: Props) {
  const { columns, showExpandable } = props;
  return (
    <BaseTable
      {...props}
      columns={
        columns || [
          { ...COLUMN.NAME, dataIndex: 'displayName', width: 160 },
          COLUMN.EXPRESSION,
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
