import { getColumnTypeIcon } from './columnType';
import { COLUMN_TYPE, NODE_TYPE } from './enum';
import { MetricIcon, ModelIcon, RelationshipIcon, ViewIcon } from './icons';
import { kailoT } from './kailoI18n';

export const getNodeTypeIcon = (
  payload: { nodeType: NODE_TYPE | string; type?: COLUMN_TYPE | string },
  attrs?: any,
) => {
  const { nodeType, type } = payload;
  switch (nodeType) {
    case NODE_TYPE.MODEL:
      return <ModelIcon title={kailoT('modeling.model')} {...attrs} />;
    case NODE_TYPE.METRIC:
      return <MetricIcon title={kailoT('modeling.metric')} {...attrs} />;
    case NODE_TYPE.VIEW:
      return <ViewIcon title={kailoT('modeling.viewNode')} {...attrs} />;
    case NODE_TYPE.RELATION:
      return (
        <RelationshipIcon title={kailoT('modeling.relationship')} {...attrs} />
      );

    case NODE_TYPE.FIELD:
      return type ? getColumnTypeIcon({ type }, attrs) : null;

    default:
      return null;
  }
};
