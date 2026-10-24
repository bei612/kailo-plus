import { ReactNode } from 'react';
import { getColumnTypeIcon } from '@/utils/columnType';
import { ComposeDiagramField, getJoinTypeText } from '@/utils/data';
import useKailoText from '@/utils/kailoI18n';

// DD-157 (`20` §9 侧滑面板 400–480, §13.2 详情侧板): the metadata drawer
// stays 480 wide, so its columns, calculated fields and relationships are
// one row per item instead of a 4–5 column table that clipped names to
// "publ…". The main line (Callout 13/500) carries the identifying text in
// full and wraps; type, relation kind, alias and description follow as a
// Caption (12/16 muted). Nothing is ellipsised, so no information is lost.

type Item = ComposeDiagramField & { expression?: string | null };

function Row(props: {
  icon?: ReactNode;
  main: ReactNode;
  side?: ReactNode;
  caption?: ReactNode[];
  nested?: boolean;
  testId?: string;
}) {
  const { icon, main, side, nested, testId } = props;
  const caption = (props.caption || []).filter(
    (part) => part !== null && part !== undefined && part !== '',
  );
  return (
    <li
      className={`kailo-meta-list__row${
        nested ? ' kailo-meta-list__row--nested' : ''
      }`}
      data-testid={testId}
    >
      {icon !== undefined && (
        <span className="kailo-meta-list__icon">{icon}</span>
      )}
      <div className="kailo-meta-list__body">
        <div className="kailo-meta-list__line">
          <span className="kailo-meta-list__main">{main}</span>
          {side ? <span className="kailo-meta-list__side">{side}</span> : null}
        </div>
        {caption.length > 0 && (
          <div className="kailo-meta-list__caption">
            {caption.map((part, index) => (
              <span key={index} className="kailo-meta-list__part">
                {part}
              </span>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

function Empty() {
  const t = useKailoText();
  return <div className="kailo-meta-list__empty">{t('noData')}</div>;
}

export function FieldList(props: {
  dataSource: Item[];
  showAlias?: boolean;
}) {
  const { dataSource = [], showAlias = true } = props;
  const t = useKailoText();
  if (!dataSource.length) return <Empty />;
  const alias = (field: { displayName?: string; referenceName?: string }) =>
    showAlias &&
    field.displayName &&
    field.displayName !== field.referenceName
      ? `${t('modeling.alias')} ${field.displayName}`
      : null;
  return (
    <ul className="kailo-meta-list" data-testid="metadata__field-list">
      {dataSource.map((field, index) => (
        <li key={`${field.id}-${index}`} className="kailo-meta-list__group">
          <ul className="kailo-meta-list kailo-meta-list--plain">
            <Row
              icon={getColumnTypeIcon({ type: field.type || '' })}
              main={field.referenceName || field.displayName || '-'}
              side={field.type}
              caption={[
                field.isPrimaryKey ? t('modeling.primaryKey') : null,
                alias(field),
                field.description,
                field.nestedFields?.length
                  ? `${t('modeling.nestedColumns')} ${t(
                      'modeling.columnCount',
                      { count: field.nestedFields.length },
                    )}`
                  : null,
              ]}
            />
            {(field.nestedFields || []).map((nested) => (
              <Row
                key={nested.id}
                nested
                icon={getColumnTypeIcon({ type: nested.type || '' })}
                main={nested.referenceName || nested.displayName || '-'}
                side={nested.type}
                caption={[alias(nested), nested.description]}
              />
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

export function CalculatedFieldList(props: { dataSource: Item[] }) {
  const { dataSource = [] } = props;
  if (!dataSource.length) return <Empty />;
  return (
    <ul className="kailo-meta-list" data-testid="metadata__calculated-list">
      {dataSource.map((field, index) => (
        <Row
          key={`${field.id}-${index}`}
          icon={getColumnTypeIcon({ type: field.type || '' })}
          main={field.displayName || field.referenceName || '-'}
          side={field.type}
          caption={[
            field.expression ? (
              <code className="kailo-meta-list__code">{field.expression}</code>
            ) : null,
            field.description,
          ]}
        />
      ))}
    </ul>
  );
}

export function RelationList(props: { dataSource: Item[] }) {
  const { dataSource = [] } = props;
  const t = useKailoText();
  if (!dataSource.length) return <Empty />;
  return (
    <ul className="kailo-meta-list" data-testid="metadata__relation-list">
      {dataSource.map((relation, index) => {
        const from = `${relation.fromModelDisplayName}.${relation.fromColumnDisplayName}`;
        const to = `${relation.toModelDisplayName}.${relation.toColumnDisplayName}`;
        return (
          <Row
            key={`${relation.id}-${index}`}
            main={
              <>
                <span aria-label={t('modeling.from')}>{from}</span>
                <span className="kailo-meta-list__arrow" aria-hidden>
                  →
                </span>
                <span aria-label={t('modeling.to')}>{to}</span>
              </>
            }
            caption={[
              getJoinTypeText(relation.type),
              relation.displayName,
              relation.description,
            ]}
          />
        );
      })}
    </ul>
  );
}
