import { Row, Col } from 'antd';
import BaseTable, {
  Props,
  COLUMN,
  ExpandableRows,
} from '@/components/table/BaseTable';
import NestedFieldTable from '@/components/table/NestedFieldTable';
import { kailoT } from '@/utils/kailoI18n';

export default function FieldTable(props: Props) {
  const { columns, showExpandable, expandable } = props;
  return (
    <BaseTable
      {...props}
      columns={
        columns || [COLUMN.NAME, COLUMN.ALIAS, COLUMN.TYPE, COLUMN.DESCRIPTION]
      }
      expandable={
        showExpandable
          ? expandable || {
              expandedRowRender: (record) => {
                return (
                  <>
                    <ExpandableRows
                      data={[
                        {
                          title: kailoT('modeling.description'),
                          value: record.description || '-',
                        },
                      ]}
                      extra={
                        record.nestedFields && (
                          <div>
                            <Row wrap={false} className="py-1 px-2">
                              <Col span={6} className="gray-7">
                                {kailoT('modeling.nestedColumns')}
                              </Col>
                              <Col style={{ wordBreak: 'break-word' }}>
                                {kailoT('modeling.columnCount', {
                                  count: record.nestedFields.length,
                                })}
                              </Col>
                            </Row>
                            <NestedFieldTable
                              dataSource={record.nestedFields as any}
                            />
                          </div>
                        )
                      }
                    />
                  </>
                );
              },
            }
          : null
      }
    />
  );
}
