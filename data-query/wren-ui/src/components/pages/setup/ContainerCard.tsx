import styled from 'styled-components';
import { Card, Steps } from 'antd';
import useKailoText from '@/utils/kailoI18n';
import { SETUP_STEP_TITLES } from './utils';

// DD-157 (20 §2): content padding 24, Kailo card (surface, 1px line, 12
// radius, no shadow) from the theme overlay.
const Container = styled.div<{ maxWidth?: number }>`
  max-width: ${(props) => props.maxWidth || 1200}px;
  margin: 24px auto;
  padding: 0 24px;
`;

interface Props {
  step: number;
  children: React.ReactNode;
  maxWidth?: number;
}

export default function ContainerCard(props: Props) {
  const { step, maxWidth } = props;
  const t = useKailoText();

  return (
    <Container maxWidth={maxWidth}>
      <Card>
        <Steps current={step} className="mb-8">
          {SETUP_STEP_TITLES.map((key) => (
            <Steps.Step key={key} title={t(key)} />
          ))}
        </Steps>
        <div className="px-6 pb-6">{props.children}</div>
      </Card>
    </Container>
  );
}
