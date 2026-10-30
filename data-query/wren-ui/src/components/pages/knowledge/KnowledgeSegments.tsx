import { useRouter } from 'next/router';
import { Path } from '@/utils/enum';
import useKailoText from '@/utils/kailoI18n';
import { KailoSegmented } from '@/components/kailo/KailoList';

type Segment = 'sqlPairs' | 'instructions';

// DD-167 (`20` §15.1): 知识 is one tab with the segments 问答对 / 指令 in
// its toolbar (no list pane, no second navigation).
export default function KnowledgeSegments(props: { active: Segment }) {
  const router = useRouter();
  const t = useKailoText();
  return (
    <KailoSegmented<Segment>
      value={props.active}
      label={t('list.segmentLabel')}
      options={[
        { value: 'sqlPairs', label: t('questionSqlPairs') },
        { value: 'instructions', label: t('instructions') },
      ]}
      onChange={(value) =>
        router.push(
          value === 'sqlPairs'
            ? Path.KnowledgeQuestionSQLPairs
            : Path.KnowledgeInstructions,
        )
      }
    />
  );
}
