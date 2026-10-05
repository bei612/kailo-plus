function hexToRgb(hexColor: string) {
  const match = hexColor.match(/^#?([0-9a-f]{6})$/i);
  if (!match) {
    return null;
  }

  const value = match[1]!;
  return {
    blue: Number.parseInt(value.slice(4, 6), 16),
    green: Number.parseInt(value.slice(2, 4), 16),
    red: Number.parseInt(value.slice(0, 2), 16),
  };
}

function relativeLuminance(hexColor: string) {
  const rgb = hexToRgb(hexColor);
  if (!rgb) {
    return 0;
  }

  const channels = [rgb.red, rgb.green, rgb.blue].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });

  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}

function contrastRatio(colorA: string, colorB: string) {
  const luminanceA = relativeLuminance(colorA);
  const luminanceB = relativeLuminance(colorB);
  const lighter = Math.max(luminanceA, luminanceB);
  const darker = Math.min(luminanceA, luminanceB);

  return (lighter + 0.05) / (darker + 0.05);
}

export function contrastColorForBackground(backgroundColor: string) {
  return contrastRatio(backgroundColor, "#000000") >=
    contrastRatio(backgroundColor, "#FFFFFF")
    ? "#000000"
    : "#FFFFFF";
}
