import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { DataNode } from 'antd/es/tree';
import { PlusIcon } from '@/components/kailo/KailoIcons';
import useKailoText, { useKailoLocale } from '@/utils/kailoI18n';
import { confirm } from '@/utils/kailoHost';
import { Path } from '@/utils/enum';
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
  const router = useRouter();
  const t = useKailoText();
  // The tree is cached in state: rebuild it when the page locale changes (the
  // embedded page switches its Next locale after the first render).
  const locale = useKailoLocale();

  // Views are saved from answers: explain, and offer to go and ask.
  const onAddView = async () => {
    const go = await confirm({
      tone: 'default',
      title: t('modeling.howToCreateView'),
      description: t('modeling.howToCreateViewHint'),
      confirmLabel: t('modeling.goAsk'),
      cancelLabel: t('cancel'),
    });
    if (go) router.push(Path.Home);
  };

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
