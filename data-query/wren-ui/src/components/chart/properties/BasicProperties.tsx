import { Form, Row, Col, Select } from 'antd';
import { ChartType } from '@/apollo/client/graphql/__types__';
import { kailoT, KailoTextKey } from '@/utils/kailoI18n';

const CHART_TYPE_LABELS: Record<ChartType, KailoTextKey> = {
  [ChartType.AREA]: 'home.chartTypeArea',
  [ChartType.BAR]: 'home.chartTypeBar',
  [ChartType.GROUPED_BAR]: 'home.chartTypeGroupedBar',
  [ChartType.LINE]: 'home.chartTypeLine',
  [ChartType.MULTI_LINE]: 'home.chartTypeMultiLine',
  [ChartType.PIE]: 'home.chartTypePie',
  [ChartType.STACKED_BAR]: 'home.chartTypeStackedBar',
};

export const getChartTypeOptions = () => {
  return Object.entries(ChartType).map(([key, value]) => ({
    label: kailoT(CHART_TYPE_LABELS[value]),
    value: key,
  }));
};

export const getColumnOptions = (
  columns: { name: string; type: string }[],
  titleMap?: Record<string, string>,
) => {
  return (columns || []).map((column) => ({
    label: titleMap?.[column.name] || column.name,
    value: column.name,
  }));
};

export function ChartTypeProperty(props: {
  options: { label: string; value: string }[];
}) {
  const { options } = props;
  return (
    <Form.Item
      className="mb-0"
      label={kailoT('home.chartType')}
      name="chartType"
    >
      <Select
        size="small"
        options={options}
        placeholder={kailoT('home.selectChartType')}
      />
    </Form.Item>
  );
}

export function AxisProperty(props: {
  options: { label: string; value: string }[];
}) {
  const { options } = props;
  return (
    <Row gutter={16}>
      <Col span={12}>
        <Form.Item className="mb-0" label={kailoT('home.xAxis')} name="xAxis">
          <Select
            size="small"
            options={options}
            placeholder={kailoT('home.selectXAxis')}
          />
        </Form.Item>
      </Col>
      <Col span={12}>
        <Form.Item className="mb-0" label={kailoT('home.yAxis')} name="yAxis">
          <Select
            size="small"
            options={options}
            placeholder={kailoT('home.selectYAxis')}
          />
        </Form.Item>
      </Col>
    </Row>
  );
}

export interface PropertiesProps {
  columns: { name: string; type: string }[];
  titleMap: Record<string, string>;
  onChartTypeChange: (chartType: ChartType) => void;
}

export default function BasicProperties(props: PropertiesProps) {
  const { columns, titleMap } = props;
  const chartTypeOptions = getChartTypeOptions();
  const columnOptions = getColumnOptions(columns, titleMap);
  return (
    <>
      <Row className="mb-2" gutter={16}>
        <Col span={12}>
          <ChartTypeProperty options={chartTypeOptions} />
        </Col>
        <Col span={12}></Col>
      </Row>
      <AxisProperty options={columnOptions} />
    </>
  );
}
