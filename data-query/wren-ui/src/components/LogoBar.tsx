import useKailoSession from '@/hooks/useKailoSession';
import { kailoProductTitle } from '@/utils/kailoI18n';
import { useRouter } from 'next/router';

// DD-133 §1: Kailo's icon (copied from the web-client build into
// public/kailo at image build time) and the deployment product name.
export default function LogoBar() {
  const { locale } = useRouter();
  const { productName } = useKailoSession();
  return (
    <span className="d-flex align-center" style={{ gap: 8 }}>
      <img src="/kailo/app-icon.png" alt="" width={24} height={24} />
      <span className="text-bold" style={{ color: 'var(--kailo-color-foreground)' }}>
        {kailoProductTitle(locale, productName)}
      </span>
    </span>
  );
}
