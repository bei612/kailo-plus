import { ExpressionName } from '@/apollo/client/graphql/__types__';
import { JOIN_TYPE } from '@/utils/enum';
import { kailoT, KailoTextKey } from '@/utils/kailoI18n';

// DD-152 (20 §13.8): relation and expression labels follow the Kailo locale.
const defaultText = () => kailoT('modeling.unknown');

export const getJoinTypeText = (type) => {
  const key = (
    {
      [JOIN_TYPE.MANY_TO_ONE]: 'modeling.joinManyToOne',
      [JOIN_TYPE.ONE_TO_MANY]: 'modeling.joinOneToMany',
      [JOIN_TYPE.ONE_TO_ONE]: 'modeling.joinOneToOne',
    } as Record<string, KailoTextKey>
  )[type];
  return key ? kailoT(key) : defaultText();
};

// Function name (syntax) stays as written; name and description are text.
const EXPRESSIONS: Partial<
  Record<ExpressionName, { syntax: string; key: string }>
> = {
  // Aggregations
  [ExpressionName.AVG]: { syntax: 'avg(column)', key: 'Avg' },
  [ExpressionName.COUNT]: { syntax: 'count(column)', key: 'Count' },
  [ExpressionName.MAX]: { syntax: 'max(column)', key: 'Max' },
  [ExpressionName.MIN]: { syntax: 'min(column)', key: 'Min' },
  [ExpressionName.SUM]: { syntax: 'sum(column)', key: 'Sum' },
  // Math functions
  [ExpressionName.ABS]: { syntax: 'abs(column)', key: 'Abs' },
  [ExpressionName.CBRT]: { syntax: 'cbrt(column)', key: 'Cbrt' },
  [ExpressionName.CEIL]: { syntax: 'ceil(column)', key: 'Ceil' },
  [ExpressionName.EXP]: { syntax: 'exp(column)', key: 'Exp' },
  [ExpressionName.FLOOR]: { syntax: 'floor(column)', key: 'Floor' },
  [ExpressionName.LN]: { syntax: 'ln(column)', key: 'Ln' },
  [ExpressionName.LOG10]: { syntax: 'log10(column)', key: 'Log10' },
  [ExpressionName.ROUND]: { syntax: 'round(column)', key: 'Round' },
  [ExpressionName.SIGN]: { syntax: 'sign(column)', key: 'Sign' },
  // String functions
  [ExpressionName.LENGTH]: { syntax: 'length(column)', key: 'Length' },
  [ExpressionName.REVERSE]: { syntax: 'reverse(column)', key: 'Reverse' },
};

export const getExpressionTexts = (type) => {
  const entry = EXPRESSIONS[type as ExpressionName];
  if (!entry)
    return {
      name: defaultText(),
      syntax: defaultText(),
      description: defaultText(),
    };
  return {
    name: kailoT(`modeling.expr${entry.key}` as KailoTextKey),
    syntax: entry.syntax,
    description: kailoT(`modeling.expr${entry.key}Desc` as KailoTextKey),
  };
};
