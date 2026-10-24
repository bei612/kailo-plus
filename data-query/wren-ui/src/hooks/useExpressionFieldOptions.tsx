import { ExpressionName } from '@/apollo/client/graphql/__types__';
import { getExpressionTexts } from '@/utils/data';
import {
  aggregations,
  mathFunctions,
  stringFunctions,
} from '@/utils/expressionType';
import { useMemo } from 'react';
import { useRouter } from 'next/router';
import { kailoT } from '@/utils/kailoI18n';

export default function useExpressionFieldOptions() {
  const { locale } = useRouter();
  const expressionOptions = useMemo(() => {
    const convertor = (name: ExpressionName) => {
      const texts = getExpressionTexts(name);
      return {
        label: texts.name,
        value: name,
        content: {
          title: texts.syntax,
          description: texts.description,
          expression: texts.syntax,
        },
      };
    };

    return [
      {
        label: kailoT('modeling.aggregation'),
        options: aggregations.map(convertor),
      },
      {
        label: kailoT('modeling.mathFunctions'),
        options: mathFunctions.map(convertor),
      },
      {
        label: kailoT('modeling.stringFunctions'),
        options: stringFunctions.map(convertor),
      },
    ];
  }, [locale]);

  return expressionOptions;
}
