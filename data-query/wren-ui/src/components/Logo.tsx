interface Props {
  size?: number;
  color?: string;
}

// DD-133 §1: the product mark is Kailo's icon (public/kailo/app-icon.png,
// copied from the web-client build); `color` is kept for existing callers.
export const Logo = (props: Props) => {
  const { size = 30 } = props;
  return (
    <img
      src="/kailo/app-icon.png"
      alt=""
      width={size}
      height={size}
      style={{ borderRadius: 6 }}
    />
  );
};
