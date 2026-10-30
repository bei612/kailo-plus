import { useEffect, useState } from 'react';
import { DataNode } from 'antd/es/tree';
import { PlusIcon } from '@/components/kailo/KailoIcons';
import useKailoText, { useKailoLocale } from '@/utils/kailoI18n';
import { notify } from '@/utils/kailoHost';
import { DiagramView } from '@/utils/data';
import { getNodeTypeIcon } from '@/utils/nodeType';
import {
  createTreeGroupNode,
  getColumnNode,
  GroupActionButton,
} from '@/components/sidebar/utils';
import LabelTitle from '@/components/sidebar/LabelTitle';
import { StyledSidebarTree } from '@/components/sidebar/Modeling';

interface Props {
  [key: string]: any;
  views: DiagramView[];
}

export default function ViewTree(props: Props) {
  const { views } = props;
  const t = useKailoText();
  // The tree is cached in state: rebuild it when the page locale changes (the
  // embedded page switches its Next locale after the first render).
  const locale = useKailoLocale();

  // Views are saved from answers: explain. DD-138(6): this tree is on the
  // modeling admin surface, which links to no business page.
  const onAddView = () =>
    notify.info(
      t('modeling.howToCreateView'),
      t('modeling.howToCreateViewHint'),
    );

  const getViewGroupNode = createTreeGroupNode({
    groupName: t('modeling.views'),
    groupKey: 'views',
    emptyText: t('modeling.noViews'),
    actions: [
      {
        key: 'add-view-info',
        render: () => (
          <GroupActionButton
            icon={<PlusIcon size={14} className="mr-1" />}
            size="small"
            onClick={onAddView}
          >
            {t('newThread')}
          </GroupActionButton>
        ),
      },
    ],
  });

  const [tree, setTree] = useState<DataNode[]>(getViewGroupNode());

  useEffect(() => {
    setTree((_tree) =>
      getViewGroupNode({
        quotaUsage: views.length,
        children: views.map((view) => {
          const nodeKey = view.id;
          const children = getColumnNode(nodeKey, view.fields || []);

          return {
            children,
            className: 'adm-treeNode',
            icon: getNodeTypeIcon({ nodeType: view.nodeType }),
            id: nodeKey,
            isLeaf: false,
            key: nodeKey,
            title: <LabelTitle title={view.displayName} />,
            type: view.nodeType,
          };
        }),
      }),
    );
  }, [views, locale]);

  return <StyledSidebarTree {...props} treeData={tree} />;
}
